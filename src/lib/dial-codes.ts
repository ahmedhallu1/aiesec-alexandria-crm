/** DIAL CODES (v33.23) — so a phone field can show an example from the
 *  country the person is actually in.
 *
 *  "+90… with the country code" is a Turkish example shown to an Indonesian.
 *  It reads as an instruction ("start with +90") rather than an illustration,
 *  and the crew has seen numbers typed with the wrong prefix because of it.
 *
 *  Every example here is a REAL mobile shape for that country — the right
 *  number of digits, the right trunk-prefix handling — and is deliberately
 *  chosen so that `normalizePhone` ACCEPTS it if someone types it literally.
 *  That matters: an example the validator would reject is worse than no
 *  example at all.
 */

/** country name (matching COUNTRIES in countries.ts) → E.164 dial code */
export const DIAL_CODES: Record<string, string> = {
  Afghanistan: "93", Albania: "355", Algeria: "213", Andorra: "376", Angola: "244",
  "Antigua and Barbuda": "1268", Argentina: "54", Armenia: "374", Australia: "61",
  Austria: "43", Azerbaijan: "994", Bahamas: "1242", Bahrain: "973", Bangladesh: "880",
  Barbados: "1246", Belarus: "375", Belgium: "32", Belize: "501", Benin: "229",
  Bhutan: "975", Bolivia: "591", "Bosnia and Herzegovina": "387", Botswana: "267",
  Brazil: "55", Brunei: "673", Bulgaria: "359", "Burkina Faso": "226", Burundi: "257",
  "Cabo Verde": "238", Cambodia: "855", Cameroon: "237", Canada: "1",
  "Central African Republic": "236", Chad: "235", Chile: "56", China: "86",
  Colombia: "57", Comoros: "269", Congo: "242", "Costa Rica": "506", Croatia: "385",
  Cuba: "53", Cyprus: "357", Czechia: "420", "Czech Republic": "420",
  "DR Congo": "243", "Democratic Republic of the Congo": "243", Denmark: "45",
  Djibouti: "253", Dominica: "1767", "Dominican Republic": "1809", Ecuador: "593",
  Egypt: "20", "El Salvador": "503", "Equatorial Guinea": "240", Eritrea: "291",
  Estonia: "372", Eswatini: "268", Ethiopia: "251", Fiji: "679", Finland: "358",
  France: "33", Gabon: "241", Gambia: "220", Georgia: "995", Germany: "49",
  Ghana: "233", Greece: "30", Grenada: "1473", Guatemala: "502", Guinea: "224",
  "Guinea-Bissau": "245", Guyana: "592", Haiti: "509", Honduras: "504", Hungary: "36",
  Iceland: "354", India: "91", Indonesia: "62", Iran: "98", Iraq: "964", Ireland: "353",
  Israel: "972", Italy: "39", "Ivory Coast": "225", Jamaica: "1876", Japan: "81",
  Jordan: "962", Kazakhstan: "7", Kenya: "254", Kiribati: "686", Kosovo: "383",
  Kuwait: "965", Kyrgyzstan: "996", Laos: "856", Latvia: "371", Lebanon: "961",
  Lesotho: "266", Liberia: "231", Libya: "218", Liechtenstein: "423", Lithuania: "370",
  Luxembourg: "352", Madagascar: "261", Malawi: "265", Malaysia: "60", Maldives: "960",
  Mali: "223", Malta: "356", "Marshall Islands": "692", Mauritania: "222",
  Mauritius: "230", Mexico: "52", Micronesia: "691", Moldova: "373", Monaco: "377",
  Mongolia: "976", Montenegro: "382", Morocco: "212", Mozambique: "258", Myanmar: "95",
  Namibia: "264", Nauru: "674", Nepal: "977", Netherlands: "31", "New Zealand": "64",
  Nicaragua: "505", Niger: "227", Nigeria: "234", "North Korea": "850",
  "North Macedonia": "389", Norway: "47", Oman: "968", Pakistan: "92", Palau: "680",
  Palestine: "970", Panama: "507", "Papua New Guinea": "675", Paraguay: "595",
  Peru: "51", Philippines: "63", Poland: "48", Portugal: "351", Qatar: "974",
  Romania: "40", Russia: "7", Rwanda: "250", "Saint Kitts and Nevis": "1869",
  "Saint Lucia": "1758", "Saint Vincent and the Grenadines": "1784", Samoa: "685",
  "San Marino": "378", "Sao Tome and Principe": "239", "Saudi Arabia": "966",
  Senegal: "221", Serbia: "381", Seychelles: "248", "Sierra Leone": "232",
  Singapore: "65", Slovakia: "421", Slovenia: "386", "Solomon Islands": "677",
  Somalia: "252", "South Africa": "27", "South Korea": "82", "South Sudan": "211",
  Spain: "34", "Sri Lanka": "94", Sudan: "249", Suriname: "597", Sweden: "46",
  Switzerland: "41", Syria: "963", Taiwan: "886", Tajikistan: "992", Tanzania: "255",
  Thailand: "66", "Timor-Leste": "670", Togo: "228", Tonga: "676",
  "Trinidad and Tobago": "1868", Tunisia: "216", Turkey: "90", Turkmenistan: "993",
  Tuvalu: "688", Uganda: "256", Ukraine: "380", "United Arab Emirates": "971",
  "United Kingdom": "44", "United States": "1", Uruguay: "598", Uzbekistan: "998",
  Vanuatu: "678", "Vatican City": "379", Venezuela: "58", Vietnam: "84", Yemen: "967",
  Zambia: "260", Zimbabwe: "263",
};

/** The national part of a realistic mobile number, per country. Used only to
 *  BUILD an example — never stored, never dialled. Countries not listed fall
 *  back to a generic run of digits of a sensible length for their dial code. */
const EXAMPLE_NATIONAL: Record<string, string> = {
  Algeria: "551 234 567", Argentina: "9 11 2345 6789", Australia: "412 345 678",
  Austria: "664 123456", Azerbaijan: "50 123 45 67", Bangladesh: "1712 345678",
  Belgium: "470 12 34 56", Brazil: "11 91234 5678", Bulgaria: "87 123 4567",
  Canada: "416 555 0123", Chile: "9 6123 4567", China: "131 2345 6789",
  Colombia: "301 234 5678", Croatia: "91 234 5678", Czechia: "601 123 456",
  "Czech Republic": "601 123 456", Denmark: "20 12 34 56", Egypt: "10 1234 5678",
  Estonia: "5123 4567", Ethiopia: "91 123 4567", Finland: "40 123 4567",
  France: "6 12 34 56 78", Georgia: "555 12 34 56", Germany: "151 23456789",
  Ghana: "24 123 4567", Greece: "691 234 5678", Hungary: "20 123 4567",
  India: "98765 43210", Indonesia: "812 3456 7890", Iraq: "770 123 4567",
  Ireland: "85 123 4567", Italy: "312 345 6789", Japan: "90 1234 5678",
  Jordan: "7 9012 3456", Kazakhstan: "701 234 5678", Kenya: "712 345678",
  Kuwait: "500 12345", Latvia: "21 234 567", Lebanon: "71 123 456",
  Lithuania: "612 34567", Malaysia: "12 345 6789", Mexico: "55 1234 5678",
  Moldova: "621 12 345", Morocco: "650 123456", Nepal: "984 1234567",
  Netherlands: "6 12345678", "New Zealand": "21 123 4567", Nigeria: "802 123 4567",
  Norway: "406 12 345", Pakistan: "301 2345678", Peru: "912 345 678",
  Philippines: "917 123 4567", Poland: "512 345 678", Portugal: "912 345 678",
  Qatar: "3312 3456", Romania: "712 345 678", Russia: "912 345 6789",
  "Saudi Arabia": "50 123 4567", Serbia: "60 1234567", Singapore: "8123 4567",
  Slovakia: "912 123 456", Slovenia: "31 234 567", "South Africa": "71 123 4567",
  "South Korea": "10 1234 5678", Spain: "612 34 56 78", "Sri Lanka": "71 234 5678",
  Sweden: "70 123 45 67", Switzerland: "78 123 45 67", Taiwan: "912 345 678",
  Tanzania: "621 234 567", Thailand: "81 234 5678", Tunisia: "20 123 456",
  Turkey: "532 123 45 67", Uganda: "712 345678", Ukraine: "50 123 4567",
  "United Arab Emirates": "50 123 4567", "United Kingdom": "7400 123456",
  "United States": "202 555 0123", Uzbekistan: "90 123 45 67", Vietnam: "91 234 56 78",
  Zambia: "95 1234567", Zimbabwe: "71 234 5678",
};

/** How many national digits to invent when a country has no curated example —
 *  short dial codes belong to big numbering plans and vice versa. */
function genericNational(dial: string): string {
  const len = dial.length >= 4 ? 7 : dial.length === 3 ? 8 : 9;
  return "123456789".slice(0, len);
}

/** "+31 6 12345678" — the example to show in a phone field for this country.
 *  Returns null when the country is unknown, so the caller keeps its generic
 *  placeholder rather than inventing a prefix. */
export function phoneExample(country: string | null | undefined): string | null {
  const c = (country ?? "").trim();
  if (!c) return null;
  const dial =
    DIAL_CODES[c] ??
    Object.entries(DIAL_CODES).find(([k]) => k.toLowerCase() === c.toLowerCase())?.[1];
  if (!dial) return null;
  const national =
    EXAMPLE_NATIONAL[c] ??
    Object.entries(EXAMPLE_NATIONAL).find(([k]) => k.toLowerCase() === c.toLowerCase())?.[1] ??
    genericNational(dial);
  return `+${dial} ${national}`;
}

/** The dial code alone, for hints like "starts with +962". */
export function dialCode(country: string | null | undefined): string | null {
  const c = (country ?? "").trim();
  if (!c) return null;
  return (
    DIAL_CODES[c] ??
    Object.entries(DIAL_CODES).find(([k]) => k.toLowerCase() === c.toLowerCase())?.[1] ??
    null
  );
}
