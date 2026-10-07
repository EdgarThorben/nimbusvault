// Business details used on the customer page and the PDF invoice.
// Everything in [BRACKETS] is a placeholder: replace before real use.
export const business = {
  name: "Leo's Workshop",
  owner: "Leo",
  address: ["[STREET AND NUMBER]", "[POSTCODE CITY]"],
  // E.164 digits without "+", used for the "Call Leo" button.
  phone: "[PHONE, e.g. 49301234567]",
  email: "[EMAIL]",
  vatId: "[VAT ID]",
  bank: { iban: "[IBAN]", bic: "[BIC]", name: "[BANK NAME]" },
  paymentTermsDays: 14,
};

// VAT rate applied to all line items (net prices are stored).
export const VAT_RATE = 0.19;

// Country calling code used to turn a local number ("0151 ...") into a WhatsApp link.
export const DEFAULT_COUNTRY_CODE = "49";

// Prototype mode: shows a one-tap "Enter the prototype" button on /login that skips the password.
// Anyone with the URL gets in, so keep it off once real customer data goes in.
export const DEMO_MODE = (process.env.DEMO_MODE ?? import.meta.env?.DEMO_MODE) === "1";
export const DEMO_LOGIN = { email: "leo@example.com", password: "workshop-demo" };
