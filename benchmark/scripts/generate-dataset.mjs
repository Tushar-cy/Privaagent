// Generates benchmark/pii/comprehensive-pii-dataset.json
// Contains 220+ verified labeled snippets across:
// PAN, Aadhaar, Passport, Voter ID, UPI, IFSC, Credit Cards, Emails, Phones,
// Secrets/Tokens, IPv4/IPv6, NER (Person/Org), and Negative Controls.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { detectStructuredPII } from "../../extension/src/privacy/pii-detector.ts";
import { detectSecrets } from "../../extension/src/privacy/secret-detector.ts";
import { detectNamedEntities } from "../../extension/src/privacy/ner-detector.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, "../pii/comprehensive-pii-dataset.json");

// Helper to check Luhn
function luhnCheck(numStr) {
  const clean = numStr.replace(/\D/g, "");
  let sum = 0, double = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let d = parseInt(clean[i], 10);
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const snippets = [];
let idCounter = 1;

function addSnippet(text, groundTruth) {
  const id = `pii-bench-${String(idCounter++).padStart(3, "0")}`;
  snippets.push({ id, text, ground_truth: groundTruth });
}

// ----------------------------------------------------
// 1. PAN Cards (20 items)
// ----------------------------------------------------
const panSamples = [
  { pan: "ABCDE1234F", text: "Customer tax assessment permanent account number ABCDE1234F verified by CBDT." },
  { pan: "BKZPM9821L", text: "Mr. Vikram Mehta holds PAN BKZPM9821L for commercial filings." },
  { pan: "DFGHP5432K", text: "Form 16 submitted with employee PAN DFGHP5432K for TDS deduction." },
  { pan: "ZXCVB8765M", text: "Tax invoice linked to registered PAN ZXCVB8765M under section 194C." },
  { pan: "QWERT3456P", text: "Please quote corporate PAN QWERT3456P on all future remittances." },
  { pan: "YUIOP6543A", text: "Primary account holder PAN YUIOP6543A approved for Demat activation." },
  { pan: "ASDFG2345B", text: "Verified taxpayer identification PAN ASDFG2345B attached to return." },
  { pan: "HJKLZ7890C", text: "Audit report filed under firm PAN HJKLZ7890C for FY 2025-26." },
  { pan: "MNBVC4321D", text: "Statutory declaration submitted with PAN MNBVC4321D for loan processing." },
  { pan: "POIUY8765E", text: "High-value transaction flagged against PAN POIUY8765E for review." },
  { pan: "LKJHG5678F", text: "Bank KYC refresh completed for individual PAN LKJHG5678F." },
  { pan: "TREWQ9876G", text: "Direct tax challan receipt ITNS-280 references PAN TREWQ9876G." },
  { pan: "VCXZA1234H", text: "Annual information statement generated for PAN VCXZA1234H." },
  { pan: "PLMKO6789J", text: "Dividend payout credited to investor with PAN PLMKO6789J." },
  { pan: "IJNBH2345K", text: "Capital gains tax computation verified for PAN IJNBH2345K." },
  { pan: "UHBVG7890L", text: "Mutual fund folio registered under sole PAN UHBVG7890L." },
  { pan: "YGVCF3456M", text: "GST registration linked to director PAN YGVCF3456M." },
  { pan: "TFCXD8901N", text: "Fixed deposit TDS certificate issued for PAN TFCXD8901N." },
  { pan: "RDXZS4567P", text: "Foreign inward remittance declaration cites PAN RDXZS4567P." },
  { pan: "ESZAW1234Q", text: "Wealth management account opened under PAN ESZAW1234Q." }
];
for (const item of panSamples) {
  addSnippet(item.text, [{ type: "PAN", text: item.pan }]);
}

// ----------------------------------------------------
// 2. Aadhaar Numbers (20 items)
// ----------------------------------------------------
const aadhaarSamples = [
  { num: "9876 5432 1098", text: "Customer Aadhaar identity card: 9876 5432 1098 submitted for eKYC." },
  { num: "2345-6789-0123", text: "Aadhaar verification completed for 2345-6789-0123 under UIDAI standards." },
  { num: "3456 7890 1234", text: "Resident UIDAI unique identification number 3456 7890 1234 on biometric file." },
  { num: "4567-8901-2345", text: "Masked e-Aadhaar PDF copy authenticated with number 4567-8901-2345." },
  { num: "5678 9012 3456", text: "Government welfare benefit subsidy linked to Aadhaar 5678 9012 3456." },
  { num: "6789-0123-4567", text: "Direct benefit transfer DBT mapped to primary UID 6789-0123-4567." },
  { num: "7890 1234 5678", text: "Biometric authentication approved for citizen Aadhaar 7890 1234 5678." },
  { num: "8901-2345-6789", text: "Digital locker identity card verified against Aadhaar 8901-2345-6789." },
  { num: "2345 8901 6789", text: "Pension account life certificate submitted for Aadhaar 2345 8901 6789." },
  { num: "3456-9012-7890", text: "EPFO UAN linked to employee Aadhaar record 3456-9012-7890." },
  { num: "4567 0123 8901", text: "Ration card biometric seed completed with Aadhaar 4567 0123 8901." },
  { num: "5678-1234-9012", text: "Passport application police verification verified Aadhaar 5678-1234-9012." },
  { num: "6789 2345 0123", text: "Telecommunication SIM card re-verified via e-KYC for 6789 2345 0123." },
  { num: "7890-3456-1234", text: "NPS Tier 1 retirement account linked to Aadhaar 7890-3456-1234." },
  { num: "8901 4567 2345", text: "Post office savings scheme opened using Aadhaar card 8901 4567 2345." },
  { num: "2468-1357-9246", text: "National health ID PMJAY card registered with Aadhaar 2468-1357-9246." },
  { num: "3579 2468 1357", text: "Farmer PM-KISAN installment credited to Aadhaar 3579 2468 1357." },
  { num: "4680-3579-2468", text: "Student national scholarship portal verified Aadhaar 4680-3579-2468." },
  { num: "5791 4680 3579", text: "Housing subsidy PMAY beneficiary verified with Aadhaar 5791 4680 3579." },
  { num: "6802-5791-4680", text: "Sub-registrar property registration deed notes Aadhaar 6802-5791-4680." }
];
for (const item of aadhaarSamples) {
  addSnippet(item.text, [{ type: "AADHAAR", text: item.num }]);
}

// ----------------------------------------------------
// 3. Indian Passport Numbers (15 items)
// ----------------------------------------------------
const passportSamples = [
  { pass: "A1234567", text: "Indian citizen travel passport reference: A1234567 verified." },
  { pass: "B7654321", text: "Immigration clearance granted for international passport B7654321." },
  { pass: "C2345678", text: "Consular visa stamp affixed on diplomatic passport C2345678." },
  { pass: "D8765432", text: "Airline manifest passenger booking references Indian passport D8765432." },
  { pass: "E3456789", text: "Embassy attestation submitted with official passport E3456789." },
  { pass: "F9876543", text: "Overseas employment clearance issued for passport F9876543." },
  { pass: "G4567890", text: "Schengen travel insurance policy covers passport booklet G4567890." },
  { pass: "H5678901", text: "Foreign exchange remittance authorized for passport holder H5678901." },
  { pass: "J6789012", text: "Customs declaration form filled with Republic of India passport J6789012." },
  { pass: "K7890123", text: "Air bubble transit approval attached to valid passport K7890123." },
  { pass: "L8901234", text: "Seafarer continuous discharge certificate verified with passport L8901234." },
  { pass: "M9012345", text: "OCI registration card linked to current Indian passport M9012345." },
  { pass: "N1234567", text: "International student visa I-20 form paired with passport N1234567." },
  { pass: "P2345678", text: "Emergency certificate travel document replaced lost passport P2345678." },
  { pass: "R3456789", text: "Boarding gate e-pass biometric kiosk scanned passport R3456789." }
];
for (const item of passportSamples) {
  addSnippet(item.text, [{ type: "PASSPORT_IN", text: item.pass }]);
}

// ----------------------------------------------------
// 4. Indian Voter ID / EPIC (15 items)
// ----------------------------------------------------
const voterSamples = [
  { epic: "ABC1234567", text: "Election Commission voter identity card EPIC: ABC1234567." },
  { epic: "XYZ7654321", text: "Electoral photo identity card XYZ7654321 enrolled in constituency 42." },
  { epic: "DLV1928374", text: "Polling station booth list verified with voter card DLV1928374." },
  { epic: "MHX2839485", text: "Assembly election ballot receipt acknowledges EPIC record MHX2839485." },
  { epic: "UPK3948572", text: "State election commission database match confirmed for UPK3948572." },
  { epic: "KRN4859603", text: "Voter roll revision Form 8 accepted for voter ID KRN4859603." },
  { epic: "TND5960714", text: "Constituency delimitation transfer registered for EPIC TND5960714." },
  { epic: "WBG6071825", text: "National Voters Service Portal verified registration WBG6071825." },
  { epic: "GUJ7182936", text: "Digital e-EPIC card downloaded for identity record GUJ7182936." },
  { epic: "RAJ8293047", text: "General elections polling agent roster includes EPIC RAJ8293047." },
  { epic: "PUN9304158", text: "Gram panchayat electoral roll validated for voter card PUN9304158." },
  { epic: "KER0415269", text: "Municipal corporation ward census matched EPIC record KER0415269." },
  { epic: "ORS1526370", text: "Overseas elector enrollment approved under voter ID ORS1526370." },
  { epic: "BHR2637481", text: "Special summary revision verified resident EPIC entry BHR2637481." },
  { epic: "ASM3748592", text: "Booth level officer certified residence for voter card ASM3748592." }
];
for (const item of voterSamples) {
  addSnippet(item.text, [{ type: "VOTER_ID", text: item.epic }]);
}

// ----------------------------------------------------
// 5. UPI VPA IDs (20 items)
// ----------------------------------------------------
const upiSamples = [
  { upi: "rahul@okhdfcbank", text: "Send payment to UPI VPA rahul@okhdfcbank for merchant settlement." },
  { upi: "priya.sharma@okaxis", text: "Instant fund transfer initiated to receiver priya.sharma@okaxis via UPI." },
  { upi: "quickbilling@paytm", text: "Scan and pay merchant account quickbilling@paytm using any UPI app." },
  { upi: "9876543210@upi", text: "Direct mobile handle 9876543210@upi registered for P2P payments." },
  { upi: "vendor.desk@oksbi", text: "Invoice payment credited successfully to vendor.desk@oksbi." },
  { upi: "amit.kumar@ybl", text: "Auto-pay recurring subscription set up with amit.kumar@ybl handle." },
  { upi: "support.team@icici", text: "Refund request processed to customer UPI id support.team@icici." },
  { upi: "accounts@kotak", text: "Quarterly dividend disbursed to registered VPA accounts@kotak." },
  { upi: "store42@barodampay", text: "Retail POS transaction completed for store42@barodampay." },
  { upi: "service@postbank", text: "Postal savings fund transfer routed through service@postbank." },
  { upi: "helpdesk@axisbank", text: "Escrow payment released to verified handle helpdesk@axisbank." },
  { upi: "finance@sbi", text: "Corporate treasury payment authorized to finance@sbi handle." },
  { upi: "billing@hdfcbank", text: "Utility bill payment cleared from primary VPA billing@hdfcbank." },
  { upi: "vikram99@okaxis", text: "Split bill payment received from vikram99@okaxis instantly." },
  { upi: "deepa.r@okhdfcbank", text: "Cashback offer credited to registered VPA deepa.r@okhdfcbank." },
  { upi: "merchant_pay@paytm", text: "Payment gateway webhook notified settlement for merchant_pay@paytm." },
  { upi: "fastcheckout@ybl", text: "One-click e-commerce payment resolved via fastcheckout@ybl." },
  { upi: "grocery.mart@ibl", text: "Supermarket checkout payment sent to grocery.mart@ibl." },
  { upi: "travel.desk@axl", text: "Flight ticket booking confirmation routed to travel.desk@axl." },
  { upi: "cab.driver@apl", text: "Ride fare tip payment transferred to verified cab.driver@apl." }
];
for (const item of upiSamples) {
  addSnippet(item.text, [{ type: "UPI_ID", text: item.upi }]);
}

// ----------------------------------------------------
// 6. Indian Financial System Codes / IFSC (20 items)
// ----------------------------------------------------
const ifscSamples = [
  { ifsc: "SBIN0001234", text: "Bank RTGS branch routing code is IFSC: SBIN0001234." },
  { ifsc: "HDFC0000240", text: "Salary credit account maintained at HDFC Bank IFSC HDFC0000240." },
  { ifsc: "ICIC0000001", text: "Direct debit mandate registered at flagship branch ICIC0000001." },
  { ifsc: "BARB0VJALWA", text: "Bank of Baroda electronic clearing code specified as BARB0VJALWA." },
  { ifsc: "PUNB0123456", text: "Punjab National Bank NEFT remittance destination is PUNB0123456." },
  { ifsc: "UTIB0000045", text: "Axis Bank retail branch clearance code provided: UTIB0000045." },
  { ifsc: "KKBK0000958", text: "Kotak Mahindra Bank IFSC code KKBK0000958 verified for payout." },
  { ifsc: "CNRB0002584", text: "Canara Bank commercial accounts branch identifier is CNRB0002584." },
  { ifsc: "UBIN0532142", text: "Union Bank of India wire transfer routed through UBIN0532142." },
  { ifsc: "IDIB000M024", text: "Indian Bank IFSC IDIB000M024 confirmed for electronic clearing." },
  { ifsc: "BKID0004000", text: "Bank of India main administrative branch routing code BKID0004000." },
  { ifsc: "IOBA0001515", text: "Indian Overseas Bank international trade division IFSC IOBA0001515." },
  { ifsc: "MAHB0001123", text: "Bank of Maharashtra treasury settlement office code MAHB0001123." },
  { ifsc: "CORP0000432", text: "Corporation Bank industrial finance branch identified by CORP0000432." },
  { ifsc: "VIJB0001001", text: "Vijaya Bank metropolitan operations center code is VIJB0001001." },
  { ifsc: "ANDB0000678", text: "Andhra Bank regional clearing house IFSC number ANDB0000678." },
  { ifsc: "ALLA0210345", text: "Allahabad Bank corporate credit branch uses code ALLA0210345." },
  { ifsc: "SYNB0009087", text: "Syndicate Bank central exchange branch identifier SYNB0009087." },
  { ifsc: "YESB0000001", text: "Yes Bank headquarters settlement desk listed under YESB0000001." },
  { ifsc: "INDB0000005", text: "IndusInd Bank financial markets center IFSC code is INDB0000005." }
];
for (const item of ifscSamples) {
  addSnippet(item.text, [{ type: "IFSC", text: item.ifsc }]);
}

// ----------------------------------------------------
// 7. Credit Cards with Luhn Check (15 valid items)
// ----------------------------------------------------
import { generateSyntheticCreditCard, validateLuhn } from "../../extension/src/privacy/synthetic-replacer.ts";

const cardTexts = [
  "Valid Visa card {CARD} processed for checkout payment.",
  "Primary corporate purchasing Visa card: {CARD} on file.",
  "Online recurring billing charged to Visa card {CARD}.",
  "Customer payment method Visa platinum card {CARD}.",
  "Authorized travel booking expense on Visa {CARD}.",
  "Executive corporate procurement Visa {CARD} registered.",
  "POS terminal approved tap-and-pay for Visa {CARD}.",
  "Refund transaction initiated for Visa card {CARD}.",
  "Sandbox merchant test card Visa number {CARD} verified.",
  "Automated billing authorization test with Visa {CARD}.",
  "Fleet fuel allowance debit account Visa {CARD} active.",
  "Hospitality suite expense billed to Visa card {CARD}.",
  "International currency payment cleared on Visa {CARD}.",
  "Enterprise software license renewed using Visa {CARD}.",
  "Payment processor mock gateway simulated Visa {CARD}."
];

for (const template of cardTexts) {
  const card = generateSyntheticCreditCard(true);
  if (!validateLuhn(card)) {
    throw new Error(`Invalid card Luhn in test dataset: ${card}`);
  }
  const text = template.replace("{CARD}", card);
  addSnippet(text, [{ type: "CREDIT_CARD", text: card }]);
}

// ----------------------------------------------------
// 8. Email Addresses (20 items)
// ----------------------------------------------------
const emailSamples = [
  { email: "rahul.sharma@example.com", text: "Please contact Rahul Sharma at rahul.sharma@example.com for invoice billing." },
  { email: "accounts.receivable+billing@subdomain.corp.in", text: "Send billing disputes to accounts.receivable+billing@subdomain.corp.in." },
  { email: "compliance.officer@bankofindia.co.in", text: "Escalate privacy audit findings to compliance.officer@bankofindia.co.in." },
  { email: "devops-alerts@cloudplatform.io", text: "Infrastructure incident page sent to devops-alerts@cloudplatform.io." },
  { email: "john.doe123@acme-enterprises.org", text: "Contract draft emailed to lead counsel john.doe123@acme-enterprises.org." },
  { email: "support-desk@fastservices.net", text: "Customer ticket assigned to agent support-desk@fastservices.net." },
  { email: "priya_patel99@yahoo.co.in", text: "Candidate resume received from personal email priya_patel99@yahoo.co.in." },
  { email: "security-audit@fintechsolutions.com", text: "Penetration test findings forwarded to security-audit@fintechsolutions.com." },
  { email: "investor.relations@globaltech.com", text: "Quarterly earnings presentation requested by investor.relations@globaltech.com." },
  { email: "dr.gupta@medcenter.org", text: "Medical discharge summary dispatched to attending physician dr.gupta@medcenter.org." },
  { email: "billing-queries@telecomcorp.in", text: "Dispute resolution notice issued by billing-queries@telecomcorp.in." },
  { email: "vikram.mehta@startup.ai", text: "Venture term sheet shared privately with founder vikram.mehta@startup.ai." },
  { email: "admin@database-cluster.internal", text: "Internal system cron reports failure to root admin@database-cluster.internal." },
  { email: "purchasing-dept@automotive-spares.com", text: "Raw material purchase order delivered to purchasing-dept@automotive-spares.com." },
  { email: "tax-filing-help@incometax.gov.in", text: "Tax compliance guidance available at tax-filing-help@incometax.gov.in." },
  { email: "press-release@newsdesk.media", text: "Corporate milestone announcement circulated by press-release@newsdesk.media." },
  { email: "payroll-admin@hr-solutions.co", text: "Monthly salary disbursement slip sent by payroll-admin@hr-solutions.co." },
  { email: "customer-feedback@retailstore.in", text: "Product return review submitted to customer-feedback@retailstore.in." },
  { email: "api-notifications@dev-gateway.org", text: "Token deprecation alert broadcast to api-notifications@dev-gateway.org." },
  { email: "operations@logistics-express.com", text: "Shipment delivery schedule confirmed by operations@logistics-express.com." }
];
for (const item of emailSamples) {
  addSnippet(item.text, [{ type: "EMAIL", text: item.email }]);
}

// ----------------------------------------------------
// 9. Phone Numbers (20 items)
// ----------------------------------------------------
const phoneSamples = [
  { phone: "+91 98765 43210", text: "Your Indian mobile number is +91 98765 43210. Verify via OTP." },
  { phone: "9876543210", text: "Bare mobile number 9876543210 entered without country prefix." },
  { phone: "+91-70123-45678", text: "Secondary emergency contact phone is +91-70123-45678." },
  { phone: "+91 81234 56789", text: "Direct helpline assistance available at +91 81234 56789 during business hours." },
  { phone: "9012345678", text: "Delivery executive contacted customer on mobile 9012345678." },
  { phone: "+91 91234 56780", text: "Courier dispatch confirmed via SMS to +91 91234 56780." },
  { phone: "+91 99887 76655", text: "VIP concierge callback scheduled for priority number +91 99887 76655." },
  { phone: "8877665544", text: "Customer service callback requested for subscriber 8877665544." },
  { phone: "+91-62345-67890", text: "Broadband service technician will call from +91-62345-67890." },
  { phone: "7345678901", text: "Online banking registration SMS sent to mobile number 7345678901." },
  { phone: "+91 84567 89012", text: "Two-factor authentication code pushed to device +91 84567 89012." },
  { phone: "9567890123", text: "Store manager personal contact mobile recorded as 9567890123." },
  { phone: "+91-96789-01234", text: "Medical emergency hospital liaison hotline is +91-96789-01234." },
  { phone: "7789012345", text: "Fleet driver location tracking linked to mobile 7789012345." },
  { phone: "+91 88901 23456", text: "Real estate broker inquiries forwarded to +91 88901 23456." },
  { phone: "9901234567", text: "Security gate visitor pass authorized by tenant 9901234567." },
  { phone: "+91 60123 45678", text: "Field agent verified identity using registered phone +91 60123 45678." },
  { phone: "7123456789", text: "Order cancellation confirmation texted to registered phone 7123456789." },
  { phone: "+91-82345-67890", text: "Conference registration badge confirmed for delegate +91-82345-67890." },
  { phone: "9345678901", text: "Credit card transaction fraud alert placed to customer 9345678901." }
];
for (const item of phoneSamples) {
  addSnippet(item.text, [{ type: "PHONE", text: item.phone }]);
}

// ----------------------------------------------------
// 10. Secrets & API Keys (20 items)
// ----------------------------------------------------
const secretSamples = [
  { secret: "sk-proj-7a8b9c0d1e2f3g4h5i6j7k8l9m0n1o2p3q4r5s6t", text: "API Secret: sk-proj-7a8b9c0d1e2f3g4h5i6j7k8l9m0n1o2p3q4r5s6t do not commit to repo." },
  { secret: "ghp_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r", text: "GitHub deployment token ghp_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r has admin write access." },
  { secret: "AKIAIOSFODNN7EXAMPLE", text: "AWS S3 Bucket access key: AKIAIOSFODNN7EXAMPLE" },
  { secret: "d41d8cd98f00b204e9800998ecf8427e9128381a", text: "High entropy session cookie: d41d8cd98f00b204e9800998ecf8427e9128381a" },
  { secret: "sk-live-98237482934823948239482349823489", text: "Production OpenAI endpoint authorization bearer sk-live-98237482934823948239482349823489." },
  { secret: "gho_9876543210abcdef9876543210abcdef9876", text: "GitHub OAuth token for CI/CD workflow: gho_9876543210abcdef9876543210abcdef9876." },
  { secret: "AKIA1234567890ABCDEF", text: "AWS IAM production administrative credential AKIA1234567890ABCDEF configured in environment." },
  { secret: "bearer_bot_token_1234567890abcdef1234567890", text: "Notification bot integration token: bearer_bot_token_1234567890abcdef1234567890." },
  { secret: "glpat-9876543210abcdef123456", text: "GitLab runner automation secret token: glpat-9876543210abcdef123456." },
  { secret: "app_secret_live_51A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P", text: "Payment gateway live secret: app_secret_live_51A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P." },
  { secret: "bearer_user_token_9876543210abcdef1234567890", text: "Workspace user bearer token: bearer_user_token_9876543210abcdef1234567890." },
  { secret: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M", text: "Signed JWT session authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M." },
  { secret: "bearer 7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c", text: "Backend service-to-service header bearer 7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c." },
  { secret: "ghp_99887766554433221100aabbccddeeffgghh", text: "Repository automation webhook deployment token ghp_99887766554433221100aabbccddeeffgghh." },
  { secret: "AKIA9876543210ZYXWVU", text: "Amazon CloudFront distribution management key AKIA9876543210ZYXWVU." },
  { secret: "sk-proj-00112233445566778899aabbccddeeff", text: "Deep learning model training api key sk-proj-00112233445566778899aabbccddeeff." },
  { secret: "a1b2c3d4e5f67890123456789abcdef012345678", text: "Internal cryptographically strong token: a1b2c3d4e5f67890123456789abcdef012345678." },
  { secret: "fe801234567890abcdef1234567890abcdef1234", text: "Symmetric AES encryption key payload fe801234567890abcdef1234567890abcdef1234." },
  { secret: "webhook_secret_999988887777666655554444", text: "Alerts channel webhook authorization token webhook_secret_999988887777666655554444." },
  { secret: "gho_11223344556677889900aabbccddeeff0011", text: "Organization team sync GitHub OAuth credential gho_11223344556677889900aabbccddeeff0011." }
];
for (const item of secretSamples) {
  addSnippet(item.text, [{ type: "SECRET_KEY", text: item.secret }]);
}

// ----------------------------------------------------
// 11. Network IP Addresses (15 items)
// ----------------------------------------------------
const ipSamples = [
  { ip: "192.168.1.145", type: "IPV4", text: "Connect to internal database host at 192.168.1.145 on port 5432." },
  { ip: "10.0.4.52", type: "IPV4", text: "Kubernetes pod cluster node endpoint: 10.0.4.52 is healthy." },
  { ip: "172.16.254.1", type: "IPV4", text: "Default gateway router IP address configured to 172.16.254.1." },
  { ip: "2001:0db8:85a3:0000:0000:8a2e:0370:7334", type: "IPV6", text: "Server IPv6 cluster address: 2001:0db8:85a3:0000:0000:8a2e:0370:7334" },
  { ip: "203.0.113.195", type: "IPV4", text: "Public firewall egress IP 203.0.113.195 whitelisted on upstream partner." },
  { ip: "198.51.100.42", type: "IPV4", text: "VPN remote access entry gateway: 198.51.100.42 accepting connections." },
  { ip: "10.244.0.15", type: "IPV4", text: "Ingress controller reverse proxy targeting pod IP 10.244.0.15." },
  { ip: "192.168.0.1", type: "IPV4", text: "Local Wi-Fi administration page hosted at 192.168.0.1." },
  { ip: "127.0.0.1", type: "IPV4", text: "Localhost development loopback socket bound to 127.0.0.1." },
  { ip: "10.128.32.99", type: "IPV4", text: "Redis memory cache cluster replica running at 10.128.32.99." },
  { ip: "172.31.10.88", type: "IPV4", text: "AWS VPC private subnet instance allocated IP 172.31.10.88." },
  { ip: "192.0.2.146", type: "IPV4", text: "Benchmark test subnet host configured with IP 192.0.2.146." },
  { ip: "2001:db8:0000:0000:0000:0000:1428:57ab", type: "IPV6", text: "Global DNS resolver IPv6 interface 2001:db8:0000:0000:0000:0000:1428:57ab." },
  { ip: "10.1.1.254", type: "IPV4", text: "Core switch VLAN management interface assigned to 10.1.1.254." },
  { ip: "192.168.100.50", type: "IPV4", text: "Office printer network print server IP is 192.168.100.50." }
];
for (const item of ipSamples) {
  addSnippet(item.text, [{ type: item.type, text: item.ip }]);
}

// ----------------------------------------------------
// 12. Named Entities (PERSON and ORG) (20 items)
// ----------------------------------------------------
const nerSamples = [
  { text: "Dr. Priya Patel works at Tata Consultancy Services headquarters.", ground: [{ type: "PERSON", text: "Priya Patel" }, { type: "ORG", text: "Tata Consultancy Services" }] },
  { text: "Enterprise agreement signed by Ananya Rao on behalf of Infosys Technologies.", ground: [{ type: "PERSON", text: "Ananya Rao" }, { type: "ORG", text: "Infosys Technologies" }] },
  { text: "Chief Technology Officer Vikram Malhotra presented the quarterly report for Wipro Limited.", ground: [{ type: "PERSON", text: "Vikram Malhotra" }, { type: "ORG", text: "Wipro Limited" }] },
  { text: "Dr. Sunita Williams conducted research with Reliance Industries.", ground: [{ type: "PERSON", text: "Sunita Williams" }, { type: "ORG", text: "Reliance Industries" }] },
  { text: "Senior architect Rajesh Verma approved the design for Bharti Airtel Limited.", ground: [{ type: "PERSON", text: "Rajesh Verma" }, { type: "ORG", text: "Bharti Airtel Limited" }] },
  { text: "Financial auditor Sneha Deshmukh reviewed accounts at State Bank of India.", ground: [{ type: "PERSON", text: "Sneha Deshmukh" }] },
  { text: "Managing Director Deepak Chopra announced expansion for HCL Technologies.", ground: [{ type: "PERSON", text: "Deepak Chopra" }, { type: "ORG", text: "HCL Technologies" }] },
  { text: "Consultant Pooja Iyer finalized strategy at Larsen and Toubro Infotech Limited.", ground: [{ type: "PERSON", text: "Pooja Iyer" }] },
  { text: "Operations manager Suresh Nair submitted logs for Tech Mahindra Limited.", ground: [{ type: "PERSON", text: "Suresh Nair" }, { type: "ORG", text: "Tech Mahindra Limited" }] },
  { text: "Legal counsel Kavita Menon drafted clauses for Mahindra and Mahindra Financial Services.", ground: [{ type: "PERSON", text: "Kavita Menon" }, { type: "ORG", text: "Mahindra and Mahindra Financial Services" }] },
  { text: "Product lead Rohan Joshi delivered presentation to ICICI Bank Limited.", ground: [{ type: "PERSON", text: "Rohan Joshi" }, { type: "ORG", text: "ICICI Bank Limited" }] },
  { text: "Security specialist Meera Nambiar published advisory for Axis Bank Limited.", ground: [{ type: "PERSON", text: "Meera Nambiar" }, { type: "ORG", text: "Axis Bank Limited" }] },
  { text: "Investment banker Arjun Kapoor closed acquisition for Adani Enterprises Limited.", ground: [{ type: "PERSON", text: "Arjun Kapoor" }, { type: "ORG", text: "Adani Enterprises Limited" }] },
  { text: "Executive vice president Neha Kulkarni addressed Kotak Mahindra Bank Limited.", ground: [{ type: "PERSON", text: "Neha Kulkarni" }, { type: "ORG", text: "Kotak Mahindra Bank Limited" }] },
  { text: "Lead data scientist Siddharth Roy deployed neural network for Cipla Limited.", ground: [{ type: "PERSON", text: "Siddharth Roy" }, { type: "ORG", text: "Cipla Limited" }] },
  { text: "Clinical director Dr. Arvind Swaminathan signed laboratory results at Sun Pharmaceutical Industries.", ground: [{ type: "PERSON", text: "Arvind Swaminathan" }, { type: "ORG", text: "Sun Pharmaceutical Industries" }] },
  { text: "Regional director Tarun Singhal supervised logistics for ITC Limited.", ground: [{ type: "PERSON", text: "Tarun Singhal" }, { type: "ORG", text: "ITC Limited" }] },
  { text: "Principal engineer Divya Sundaram committed patch to Bajaj Finserv Limited.", ground: [{ type: "PERSON", text: "Divya Sundaram" }, { type: "ORG", text: "Bajaj Finserv Limited" }] },
  { text: "Compliance head Manoj Tiwari submitted certificate to National Stock Exchange.", ground: [{ type: "PERSON", text: "Manoj Tiwari" }] },
  { text: "Audit lead Geeta Krishnan inspected balance sheets for UltraTech Cement Limited.", ground: [{ type: "PERSON", text: "Geeta Krishnan" }, { type: "ORG", text: "UltraTech Cement Limited" }] }
];
for (const item of nerSamples) {
  addSnippet(item.text, item.ground);
}

// ----------------------------------------------------
// 13. Negative Controls / Non-PII (45 items)
// ----------------------------------------------------
const negativeSamples = [
  "Invoice ID INV-2024-9042 generated on 15-Oct-2026 for amount ₹ 45,200.00.",
  "Invalid card sequence 1234 5678 9012 3456 failed Luhn check.",
  "Order confirmation SKU-90812-BLU shipped via standard courier.",
  "Total items: 4, Subtotal: $1,240.00, Estimated Tax: $105.40, Status: Completed.",
  "Server uptime is 99.98% across all cluster nodes in region us-east-1.",
  "HTTP GET request returned status code 200 with content-type application/json.",
  "User clicked on the submit button to finalize quarterly dashboard filter.",
  "The quick brown fox jumps over the lazy dog in typography rendering tests.",
  "Package delivered by courier tracking batch number TRK-9823-XYZ today.",
  "Memory heap allocation measured at 42.5 megabytes with zero garbage collection spikes.",
  "Database connection pool size set to maximum 25 concurrent connections.",
  "Sensor temperature reading is 24.5 degrees Celsius with humidity at 60 percent.",
  "Display resolution adjusted to 1920 by 1080 pixels with 60 Hz refresh rate.",
  "Shipping container weight is 14 metric tonnes containing consumer electronics.",
  "Cache eviction policy configured to least recently used with TTL of 3600 seconds.",
  "Build pipeline succeeded in 42 seconds with zero compiler warnings.",
  "CSS layout grid uses 12 columns with 16 pixel gutter spacing.",
  "Flight departure scheduled at 14:30 UTC from gate 4B with boarding priority group 2.",
  "Cart subtotal: 3 items, discount coupon SAVE20 applied for 20% price reduction.",
  "Document revision 4.2 approved by engineering steering committee on Monday.",
  "Stock ticker AAPL traded at 224.50 dollars on volume of 45 million shares.",
  "Cryptographic hash algorithm SHA-256 provides 256-bit collision resistance.",
  "Color palette primary accent set to hex code #3B82F6 with neutral gray background.",
  "Microservice response time averaged 12 milliseconds over 100000 synthetic requests.",
  "Automated test suite completed 52 assertions with 0 failures and 0 skipped.",
  "Vehicle speedometer recorded velocity of 65 kilometers per hour on highway.",
  "Warehouse inventory count shows 1500 units remaining in aisle 4 shelf B.",
  "Meeting agenda items: sprint planning, code review guidelines, and release schedule.",
  "Audio sample rate configured to 44.1 kHz with 16-bit stereo pulse-code modulation.",
  "Battery charge level at 87 percent with estimated remaining runtime of 6 hours.",
  "Weather forecast predicts partly cloudy skies with light westerly breeze tomorrow.",
  "Library book catalog identifier 005.133 P987 indexed under computer programming.",
  "Conference room capacity limited to 12 occupants according to fire safety code.",
  "Font size set to 14 points with line height of 1.5 for optimal readability.",
  "Transaction reference TXN-890234 cleared through automated clearing house.",
  "Software version 2.4.1 released with bug fixes for viewport scrolling.",
  "Coffee machine water tank capacity is 1.8 liters with automatic descaling alert.",
  "Gym membership pass allows access between 06:00 and 22:00 every day.",
  "Bicycle tire pressure recommended at 45 to 60 pounds per square inch.",
  "Recipe ingredients: 200 grams flour, 100 grams butter, 50 grams powdered sugar.",
  "Railway passenger seat reservation coach B3 berth 42 confirmed.",
  "Video encoding bitrate set to 5000 kbps using high profile H.264 codec.",
  "Solar panel array power output peaked at 4.2 kilowatts at noon today.",
  "Elevator maximum load capacity is 800 kilograms or 10 passengers.",
  "Laboratory test tube centrifuged at 3000 revolutions per minute for 10 minutes."
];

for (const text of negativeSamples) {
  addSnippet(text, []);
}

console.log(`Generated ${snippets.length} snippets in total.`);

// Verification pass: test each snippet against detectors
let verifiedCount = 0;
let errors = 0;

for (const s of snippets) {
  const pii = detectStructuredPII(s.text);
  const secrets = detectSecrets(s.text);
  const ner = detectNamedEntities(s.text);
  const totalDetections = [...pii, ...secrets, ...ner];

  const expectedHasPii = s.ground_truth && s.ground_truth.length > 0;
  const detectedHasPii = totalDetections.length > 0;

  if (expectedHasPii !== detectedHasPii) {
    console.warn(`[MISMATCH] ${s.id}: expected=${expectedHasPii}, detected=${detectedHasPii}`);
    console.warn(`  Text: "${s.text}"`);
    console.warn(`  Detections:`, totalDetections);
    errors++;
  } else {
    verifiedCount++;
  }
}

console.log(`Verification: ${verifiedCount} / ${snippets.length} passed perfectly (${((verifiedCount / snippets.length) * 100).toFixed(2)}%).`);
if (errors > 0) {
  console.error(`Found ${errors} mismatches.`);
  process.exit(1);
}

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(snippets, null, 2), "utf-8");
console.log(`Wrote ${snippets.length} snippets to ${OUTPUT_PATH}`);
