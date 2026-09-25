import base64
import binascii
import re
import struct
import zlib
from enum import Enum
from typing import List, Optional, Tuple
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class DisclosureLevel(str, Enum):
    L0 = "L0"  # Local only
    L1 = "L1"  # Structured semantic context
    L2 = "L2"  # Sanitized visual crop
    L3 = "L3"  # Sanitized full screen


class DisclosedElement(BaseModel):
    target_id: str
    role: str
    label: str = Field(..., description="Sanitized text with PII tokens ([PERSON_1], etc.)")
    bbox: Optional[Tuple[float, float, float, float]] = None


class RedactionManifest(BaseModel):
    """Server-side representation of the extension's visual redaction record."""

    model_config = ConfigDict(populate_by_name=True)

    source_sensitive_box_count: int = Field(alias="sourceSensitiveBoxCount", ge=0)
    intersecting_box_count: int = Field(alias="intersectingBoxCount", ge=0)
    redacted_box_count: int = Field(alias="redactedBoxCount", ge=0)
    redacted_boxes: List[Tuple[float, float, float, float]] = Field(alias="redactedBoxes")
    sanitization_timestamp: Optional[float] = Field(default=None, alias="sanitizationTimestamp")

    @model_validator(mode="after")
    def validate_counts(self):
        if self.redacted_box_count != len(self.redacted_boxes):
            raise ValueError("redactedBoxCount must equal the number of redactedBoxes")
        if self.intersecting_box_count != self.redacted_box_count:
            raise ValueError("intersectingBoxCount must equal redactedBoxCount")
        if self.intersecting_box_count > self.source_sensitive_box_count:
            raise ValueError("intersectingBoxCount cannot exceed sourceSensitiveBoxCount")
        return self


_PNG_DATA_URL_PREFIX = "data:image/png;base64,"
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_MAX_PNG_DECODED_BYTES = 64 * 1024 * 1024


def _png_scanline_layout(width: int, height: int, bit_depth: int, color_type: int, interlace: int):
    channels_by_color_type = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
    channels = channels_by_color_type.get(color_type)
    valid_bit_depths = {
        0: {1, 2, 4, 8, 16},
        2: {8, 16},
        3: {1, 2, 4, 8},
        4: {8, 16},
        6: {8, 16},
    }
    if channels is None or bit_depth not in valid_bit_depths[color_type]:
        raise ValueError("screenshot_data contains an invalid PNG color format")
    if interlace not in (0, 1):
        raise ValueError("screenshot_data contains an invalid PNG interlace method")

    bits_per_pixel = channels * bit_depth
    passes = [(0, 0, 1, 1)] if interlace == 0 else [
        (0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8),
        (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2),
    ]
    pass_layouts = []
    total_bytes = 0
    for start_x, start_y, step_x, step_y in passes:
        pass_width = max(0, (width - start_x + step_x - 1) // step_x)
        pass_height = max(0, (height - start_y + step_y - 1) // step_y)
        if pass_width and pass_height:
            row_bytes = (pass_width * bits_per_pixel + 7) // 8
            pass_layouts.append((row_bytes, pass_height))
            total_bytes += (row_bytes + 1) * pass_height
    if total_bytes > _MAX_PNG_DECODED_BYTES:
        raise ValueError("screenshot_data PNG dimensions exceed the accepted size")
    return pass_layouts, total_bytes


def _validate_png_data_url(value: str) -> str:
    if not value.startswith(_PNG_DATA_URL_PREFIX):
        raise ValueError("screenshot_data must be a base64 encoded PNG data URL")

    encoded = value[len(_PNG_DATA_URL_PREFIX):]
    if not encoded or re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", encoded) is None:
        raise ValueError("screenshot_data contains invalid base64 data")
    try:
        png = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as err:
        raise ValueError("screenshot_data contains invalid base64 data") from err

    if not png.startswith(_PNG_SIGNATURE):
        raise ValueError("screenshot_data is not a valid PNG image")

    offset = len(_PNG_SIGNATURE)
    seen_ihdr = False
    seen_plte = False
    seen_idat = False
    idat_ended = False
    seen_iend = False
    color_type = None
    bit_depth = None
    interlace = None
    palette_size = 0
    width = height = 0
    compressed_image = bytearray()
    while offset < len(png):
        if offset + 12 > len(png):
            raise ValueError("screenshot_data contains a truncated PNG chunk")
        chunk_length = struct.unpack_from(">I", png, offset)[0]
        chunk_type = png[offset + 4:offset + 8]
        if any(byte not in b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" for byte in chunk_type):
            raise ValueError("screenshot_data contains an invalid PNG chunk type")
        if chunk_type[2] & 0x20:
            raise ValueError("screenshot_data contains an invalid PNG reserved bit")
        chunk_start = offset + 8
        chunk_end = chunk_start + chunk_length
        crc_end = chunk_end + 4
        if chunk_end < chunk_start or crc_end > len(png):
            raise ValueError("screenshot_data contains a truncated PNG chunk")
        chunk_data = png[chunk_start:chunk_end]
        expected_crc = struct.unpack_from(">I", png, chunk_end)[0]
        if zlib.crc32(chunk_type + chunk_data) & 0xFFFFFFFF != expected_crc:
            raise ValueError("screenshot_data contains a PNG checksum error")

        if not seen_ihdr and chunk_type != b"IHDR":
            raise ValueError("screenshot_data PNG is missing its header")
        if chunk_type == b"IHDR":
            if seen_ihdr or chunk_length != 13:
                raise ValueError("screenshot_data contains an invalid PNG header")
            width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(
                ">IIBBBBB", chunk_data
            )
            if (
                width == 0 or height == 0 or width > 0x7FFFFFFF or height > 0x7FFFFFFF
                or compression != 0 or filtering != 0
            ):
                raise ValueError("screenshot_data contains invalid PNG dimensions or methods")
            seen_ihdr = True
        elif chunk_type == b"PLTE":
            if seen_plte or seen_idat or chunk_length == 0 or chunk_length > 768 or chunk_length % 3:
                raise ValueError("screenshot_data contains an invalid PNG palette")
            seen_plte = True
            palette_size = chunk_length
        elif chunk_type == b"IDAT":
            if idat_ended:
                raise ValueError("screenshot_data PNG image data chunks are not contiguous")
            seen_idat = True
            compressed_image.extend(chunk_data)
        elif chunk_type == b"IEND":
            if chunk_length != 0 or not seen_idat or crc_end != len(png):
                raise ValueError("screenshot_data contains an invalid PNG end chunk")
            seen_iend = True
        else:
            if seen_idat:
                idat_ended = True
            # Unknown critical chunks cannot be safely interpreted.
            if chunk_type[0] & 0x20 == 0:
                raise ValueError("screenshot_data contains an unsupported critical PNG chunk")

        offset = crc_end
        if seen_iend:
            break

    if not seen_ihdr or not seen_idat or not seen_iend:
        raise ValueError("screenshot_data is an incomplete PNG image")
    if color_type == 3 and not seen_plte:
        raise ValueError("screenshot_data indexed PNG is missing its palette")
    if color_type in (0, 4) and seen_plte:
        raise ValueError("screenshot_data PNG color format does not allow a palette")
    if seen_plte and color_type == 3 and palette_size > (1 << bit_depth) * 3:
        raise ValueError("screenshot_data PNG palette exceeds its indexed color depth")

    pass_layouts, expected_size = _png_scanline_layout(width, height, bit_depth, color_type, interlace)
    try:
        decoder = zlib.decompressobj()
        raw_image = decoder.decompress(bytes(compressed_image), expected_size + 1)
    except zlib.error as err:
        raise ValueError("screenshot_data contains invalid PNG image data") from err
    if (
        len(raw_image) != expected_size
        or not decoder.eof
        or decoder.unused_data
        or decoder.unconsumed_tail
    ):
        raise ValueError("screenshot_data contains invalid PNG image data")

    offset = 0
    for row_size, row_count in pass_layouts:
        for _ in range(row_count):
            if raw_image[offset] > 4:
                raise ValueError("screenshot_data contains an invalid PNG scanline")
            offset += row_size + 1
    return value


class Disclosure(BaseModel):
    level: DisclosureLevel
    reason: str = Field(..., description="Justification for escalation level")
    task: Optional[str] = None
    elements: List[DisclosedElement] = Field(default_factory=list)
    crop_box: Optional[Tuple[float, float, float, float]] = Field(default=None, description="[x,y,w,h]")
    screenshot_data: Optional[str] = Field(default=None, description="Base64 encoded sanitized PNG data URL")
    redaction_manifest: Optional[RedactionManifest] = None
    redacted_token_count: int = Field(default=0, ge=0)

    @field_validator("screenshot_data")
    @classmethod
    def validate_screenshot_data(cls, value):
        if value is None:
            return value
        return _validate_png_data_url(value)

    @model_validator(mode="after")
    def require_visual_contract(self):
        if self.level in (DisclosureLevel.L2, DisclosureLevel.L3):
            if self.screenshot_data is None:
                raise ValueError("L2/L3 disclosure requires screenshot_data")
            if self.redaction_manifest is None:
                raise ValueError("L2/L3 disclosure requires redaction_manifest")
        return self
