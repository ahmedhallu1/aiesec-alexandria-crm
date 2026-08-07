/** TIME ZONES (v33.22) — the IR side of a booking is not in Cairo.
 *
 *  Every stored instant is UTC, so the truth was never wrong. What was wrong
 *  is that the public booking page RENDERED that truth in Cairo time and only
 *  said so in small print: an IR in Jakarta picked "6:00 PM" believing it was
 *  6 PM where they live. Google Calendar solves this by rendering in the
 *  VIEWER's zone, so we do the same — the browser reports the zone, the page
 *  is drawn in it, and the zone is stored on the booking so every later email
 *  can speak the IR's local time too.
 *
 *  This file holds the two things a browser cannot answer on its own:
 *  which country a zone belongs to (so the booking form can prefill it), and
 *  which zone a country most likely means (the fallback for bookings made
 *  before the zone was ever recorded).
 */

/** Primary IANA zone per country, plus the extra zones worth recognising for
 *  the big multi-zone countries. FIRST entry = the one used when all we know
 *  is the country. Names match `COUNTRIES` in countries.ts exactly. */
export const COUNTRY_ZONES: Record<string, string[]> = {
  Afghanistan: ["Asia/Kabul"],
  Albania: ["Europe/Tirane"],
  Algeria: ["Africa/Algiers"],
  Andorra: ["Europe/Andorra"],
  Angola: ["Africa/Luanda"],
  "Antigua and Barbuda": ["America/Antigua"],
  Argentina: ["America/Argentina/Buenos_Aires"],
  Armenia: ["Asia/Yerevan"],
  Australia: [
    "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane",
    "Australia/Adelaide", "Australia/Perth", "Australia/Darwin", "Australia/Hobart",
  ],
  Austria: ["Europe/Vienna"],
  Azerbaijan: ["Asia/Baku"],
  Bahamas: ["America/Nassau"],
  Bahrain: ["Asia/Bahrain"],
  Bangladesh: ["Asia/Dhaka"],
  Barbados: ["America/Barbados"],
  Belarus: ["Europe/Minsk"],
  Belgium: ["Europe/Brussels"],
  Belize: ["America/Belize"],
  Benin: ["Africa/Porto-Novo"],
  Bhutan: ["Asia/Thimphu"],
  Bolivia: ["America/La_Paz"],
  "Bosnia and Herzegovina": ["Europe/Sarajevo"],
  Botswana: ["Africa/Gaborone"],
  Brazil: [
    "America/Sao_Paulo", "America/Bahia", "America/Fortaleza", "America/Recife",
    "America/Manaus", "America/Cuiaba", "America/Belem", "America/Rio_Branco",
  ],
  Brunei: ["Asia/Brunei"],
  Bulgaria: ["Europe/Sofia"],
  "Burkina Faso": ["Africa/Ouagadougou"],
  Burundi: ["Africa/Bujumbura"],
  "Cabo Verde": ["Atlantic/Cape_Verde"],
  Cambodia: ["Asia/Phnom_Penh"],
  Cameroon: ["Africa/Douala"],
  Canada: [
    "America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg",
    "America/Halifax", "America/St_Johns", "America/Regina", "America/Montreal",
  ],
  "Central African Republic": ["Africa/Bangui"],
  Chad: ["Africa/Ndjamena"],
  Chile: ["America/Santiago"],
  China: ["Asia/Shanghai", "Asia/Urumqi"],
  Colombia: ["America/Bogota"],
  Comoros: ["Indian/Comoro"],
  Congo: ["Africa/Brazzaville"],
  "Costa Rica": ["America/Costa_Rica"],
  Croatia: ["Europe/Zagreb"],
  Cuba: ["America/Havana"],
  Cyprus: ["Asia/Nicosia"],
  Czechia: ["Europe/Prague"],
  "Czech Republic": ["Europe/Prague"],
  "DR Congo": ["Africa/Kinshasa", "Africa/Lubumbashi"],
  "Democratic Republic of the Congo": ["Africa/Kinshasa", "Africa/Lubumbashi"],
  Denmark: ["Europe/Copenhagen"],
  Djibouti: ["Africa/Djibouti"],
  Dominica: ["America/Dominica"],
  "Dominican Republic": ["America/Santo_Domingo"],
  Ecuador: ["America/Guayaquil"],
  Egypt: ["Africa/Cairo"],
  "El Salvador": ["America/El_Salvador"],
  "Equatorial Guinea": ["Africa/Malabo"],
  Eritrea: ["Africa/Asmara"],
  Estonia: ["Europe/Tallinn"],
  Eswatini: ["Africa/Mbabane"],
  Ethiopia: ["Africa/Addis_Ababa"],
  Fiji: ["Pacific/Fiji"],
  Finland: ["Europe/Helsinki"],
  France: ["Europe/Paris"],
  Gabon: ["Africa/Libreville"],
  Gambia: ["Africa/Banjul"],
  Georgia: ["Asia/Tbilisi"],
  Germany: ["Europe/Berlin"],
  Ghana: ["Africa/Accra"],
  Greece: ["Europe/Athens"],
  Grenada: ["America/Grenada"],
  Guatemala: ["America/Guatemala"],
  Guinea: ["Africa/Conakry"],
  "Guinea-Bissau": ["Africa/Bissau"],
  Guyana: ["America/Guyana"],
  Haiti: ["America/Port-au-Prince"],
  Honduras: ["America/Tegucigalpa"],
  Hungary: ["Europe/Budapest"],
  Iceland: ["Atlantic/Reykjavik"],
  India: ["Asia/Kolkata"],
  Indonesia: ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Pontianak"],
  Iran: ["Asia/Tehran"],
  Iraq: ["Asia/Baghdad"],
  Ireland: ["Europe/Dublin"],
  Israel: ["Asia/Jerusalem"],
  Italy: ["Europe/Rome"],
  "Ivory Coast": ["Africa/Abidjan"],
  Jamaica: ["America/Jamaica"],
  Japan: ["Asia/Tokyo"],
  Jordan: ["Asia/Amman"],
  Kazakhstan: ["Asia/Almaty", "Asia/Aqtobe", "Asia/Atyrau"],
  Kenya: ["Africa/Nairobi"],
  Kiribati: ["Pacific/Tarawa"],
  Kosovo: ["Europe/Belgrade"],
  Kuwait: ["Asia/Kuwait"],
  Kyrgyzstan: ["Asia/Bishkek"],
  Laos: ["Asia/Vientiane"],
  Latvia: ["Europe/Riga"],
  Lebanon: ["Asia/Beirut"],
  Lesotho: ["Africa/Maseru"],
  Liberia: ["Africa/Monrovia"],
  Libya: ["Africa/Tripoli"],
  Liechtenstein: ["Europe/Vaduz"],
  Lithuania: ["Europe/Vilnius"],
  Luxembourg: ["Europe/Luxembourg"],
  Madagascar: ["Indian/Antananarivo"],
  Malawi: ["Africa/Blantyre"],
  Malaysia: ["Asia/Kuala_Lumpur", "Asia/Kuching"],
  Maldives: ["Indian/Maldives"],
  Mali: ["Africa/Bamako"],
  Malta: ["Europe/Malta"],
  "Marshall Islands": ["Pacific/Majuro"],
  Mauritania: ["Africa/Nouakchott"],
  Mauritius: ["Indian/Mauritius"],
  Mexico: [
    "America/Mexico_City", "America/Monterrey", "America/Tijuana",
    "America/Chihuahua", "America/Cancun", "America/Mazatlan",
  ],
  Micronesia: ["Pacific/Pohnpei"],
  Moldova: ["Europe/Chisinau"],
  Monaco: ["Europe/Monaco"],
  Mongolia: ["Asia/Ulaanbaatar"],
  Montenegro: ["Europe/Podgorica"],
  Morocco: ["Africa/Casablanca"],
  Mozambique: ["Africa/Maputo"],
  Myanmar: ["Asia/Yangon"],
  Namibia: ["Africa/Windhoek"],
  Nauru: ["Pacific/Nauru"],
  Nepal: ["Asia/Kathmandu"],
  Netherlands: ["Europe/Amsterdam"],
  "New Zealand": ["Pacific/Auckland"],
  Nicaragua: ["America/Managua"],
  Niger: ["Africa/Niamey"],
  Nigeria: ["Africa/Lagos"],
  "North Korea": ["Asia/Pyongyang"],
  "North Macedonia": ["Europe/Skopje"],
  Norway: ["Europe/Oslo"],
  Oman: ["Asia/Muscat"],
  Pakistan: ["Asia/Karachi"],
  Palau: ["Pacific/Palau"],
  Palestine: ["Asia/Hebron", "Asia/Gaza"],
  Panama: ["America/Panama"],
  "Papua New Guinea": ["Pacific/Port_Moresby"],
  Paraguay: ["America/Asuncion"],
  Peru: ["America/Lima"],
  Philippines: ["Asia/Manila"],
  Poland: ["Europe/Warsaw"],
  Portugal: ["Europe/Lisbon", "Atlantic/Azores"],
  Qatar: ["Asia/Qatar"],
  Romania: ["Europe/Bucharest"],
  Russia: [
    "Europe/Moscow", "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Krasnoyarsk",
    "Asia/Irkutsk", "Asia/Vladivostok", "Europe/Kaliningrad", "Asia/Omsk",
  ],
  Rwanda: ["Africa/Kigali"],
  "Saint Kitts and Nevis": ["America/St_Kitts"],
  "Saint Lucia": ["America/St_Lucia"],
  "Saint Vincent and the Grenadines": ["America/St_Vincent"],
  Samoa: ["Pacific/Apia"],
  "San Marino": ["Europe/San_Marino"],
  "Sao Tome and Principe": ["Africa/Sao_Tome"],
  "Saudi Arabia": ["Asia/Riyadh"],
  Senegal: ["Africa/Dakar"],
  Serbia: ["Europe/Belgrade"],
  Seychelles: ["Indian/Mahe"],
  "Sierra Leone": ["Africa/Freetown"],
  Singapore: ["Asia/Singapore"],
  Slovakia: ["Europe/Bratislava"],
  Slovenia: ["Europe/Ljubljana"],
  "Solomon Islands": ["Pacific/Guadalcanal"],
  Somalia: ["Africa/Mogadishu"],
  "South Africa": ["Africa/Johannesburg"],
  "South Korea": ["Asia/Seoul"],
  "South Sudan": ["Africa/Juba"],
  Spain: ["Europe/Madrid", "Atlantic/Canary"],
  "Sri Lanka": ["Asia/Colombo"],
  Sudan: ["Africa/Khartoum"],
  Suriname: ["America/Paramaribo"],
  Sweden: ["Europe/Stockholm"],
  Switzerland: ["Europe/Zurich"],
  Syria: ["Asia/Damascus"],
  Taiwan: ["Asia/Taipei"],
  Tajikistan: ["Asia/Dushanbe"],
  Tanzania: ["Africa/Dar_es_Salaam"],
  Thailand: ["Asia/Bangkok"],
  "Timor-Leste": ["Asia/Dili"],
  Togo: ["Africa/Lome"],
  Tonga: ["Pacific/Tongatapu"],
  "Trinidad and Tobago": ["America/Port_of_Spain"],
  Tunisia: ["Africa/Tunis"],
  Turkey: ["Europe/Istanbul"],
  Turkmenistan: ["Asia/Ashgabat"],
  Tuvalu: ["Pacific/Funafuti"],
  Uganda: ["Africa/Kampala"],
  Ukraine: ["Europe/Kyiv"],
  "United Arab Emirates": ["Asia/Dubai"],
  "United Kingdom": ["Europe/London"],
  "United States": [
    "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "America/Phoenix", "America/Anchorage", "Pacific/Honolulu", "America/Detroit",
  ],
  Uruguay: ["America/Montevideo"],
  Uzbekistan: ["Asia/Tashkent"],
  Vanuatu: ["Pacific/Efate"],
  "Vatican City": ["Europe/Vatican"],
  Venezuela: ["America/Caracas"],
  Vietnam: ["Asia/Ho_Chi_Minh"],
  Yemen: ["Asia/Aden"],
  Zambia: ["Africa/Lusaka"],
  Zimbabwe: ["Africa/Harare"],
};

/** zone → country, inverted from the table above. Zones we don't know return
 *  undefined, which means "don't prefill the country" — a wrong guess is
 *  worse than an empty field the IR fills in themselves. */
export const COUNTRY_BY_ZONE: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [country, zones] of Object.entries(COUNTRY_ZONES))
    for (const z of zones) if (!out[z]) out[z] = country;
  // aliases the tz database still hands out on some platforms
  out["Europe/Kiev"] = "Ukraine";
  out["Asia/Calcutta"] = "India";
  out["Asia/Saigon"] = "Vietnam";
  out["Asia/Rangoon"] = "Myanmar";
  out["Africa/Asmera"] = "Eritrea";
  out["America/Buenos_Aires"] = "Argentina";
  out["Asia/Istanbul"] = "Turkey";
  return out;
})();

/** Is this a zone the runtime actually understands? Anything arriving from a
 *  browser or a URL is untrusted — an unknown zone must never reach
 *  `toLocaleString`, which throws on it. */
export function isValidZone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== "string" || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz))
    return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The best zone for a booking we only know the COUNTRY of — the fallback for
 *  every call booked before the zone was recorded. Null when we can't tell,
 *  so the caller can say "Cairo time" honestly instead of guessing. */
export function zoneForCountry(country: string | null | undefined): string | null {
  const c = (country ?? "").trim();
  if (!c) return null;
  const exact = COUNTRY_ZONES[c];
  if (exact) return exact[0];
  const lower = c.toLowerCase();
  for (const [name, zones] of Object.entries(COUNTRY_ZONES))
    if (name.toLowerCase() === lower) return zones[0];
  return null;
}

export function countryForZone(tz: string | null | undefined): string | null {
  const z = (tz ?? "").trim();
  return (z && COUNTRY_BY_ZONE[z]) || null;
}

/** "GMT+3" for a zone at a given instant — offsets move with DST, so it is
 *  always computed against the actual moment, never assumed. */
export function zoneOffsetLabel(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(d);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** The city half of a zone id — "Europe/Istanbul" → "Istanbul". */
export function zoneCity(tz: string): string {
  return (tz.split("/").pop() ?? tz).replaceAll("_", " ");
}

/** THE label an IR sees: "Sat, Aug 9 · 6:00 PM GMT+3 (Istanbul)".
 *
 *  One function, used by the public pages AND every outbound email, so the
 *  page and the mail can never disagree about what time the call is. */
export function whenLabelInZone(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const zone = isValidZone(tz) ? tz : "Africa/Cairo";
  const date = d.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: zone,
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: zone,
  });
  const off = zoneOffsetLabel(d, zone);
  return `${date} · ${time}${off ? ` ${off}` : ""} (${zoneCity(zone)})`;
}
