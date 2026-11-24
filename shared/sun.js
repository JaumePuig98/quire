/* Day or night, from the sun: sunrise and sunset for where the computer is, so the Evening theme follows the seasons.
   The place comes from the time zone (its main city), which is accurate to a few minutes for a theme switch.
   Works in the app and in Node (tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sun = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [latitude, longitude east] of the main city of common time zones
  const ZONES = {
    'America/Toronto': [43.65, -79.38], 'America/New_York': [40.71, -74.0], 'America/Chicago': [41.88, -87.63], 'America/Denver': [39.74, -104.99],
    'America/Los_Angeles': [34.05, -118.24], 'America/Vancouver': [49.28, -123.12], 'America/Edmonton': [53.55, -113.49], 'America/Winnipeg': [49.9, -97.14],
    'America/Halifax': [44.65, -63.57], 'America/St_Johns': [47.56, -52.71], 'America/Mexico_City': [19.43, -99.13], 'America/Bogota': [4.71, -74.07],
    'America/Lima': [-12.05, -77.04], 'America/Santiago': [-33.45, -70.67], 'America/Argentina/Buenos_Aires': [-34.6, -58.38], 'America/Sao_Paulo': [-23.55, -46.63],
    'Europe/Madrid': [40.42, -3.7], 'Atlantic/Canary': [28.1, -15.4], 'Europe/London': [51.51, -0.13], 'Europe/Dublin': [53.35, -6.26], 'Europe/Lisbon': [38.72, -9.14],
    'Europe/Paris': [48.86, 2.35], 'Europe/Berlin': [52.52, 13.4], 'Europe/Rome': [41.9, 12.5], 'Europe/Amsterdam': [52.37, 4.9], 'Europe/Brussels': [50.85, 4.35],
    'Europe/Zurich': [47.37, 8.54], 'Europe/Vienna': [48.21, 16.37], 'Europe/Stockholm': [59.33, 18.07], 'Europe/Oslo': [59.91, 10.75], 'Europe/Helsinki': [60.17, 24.94],
    'Europe/Warsaw': [52.23, 21.01], 'Europe/Athens': [37.98, 23.73], 'Europe/Istanbul': [41.01, 28.98], 'Europe/Moscow': [55.76, 37.62],
    'Africa/Cairo': [30.04, 31.24], 'Africa/Johannesburg': [-26.2, 28.04], 'Africa/Lagos': [6.52, 3.38], 'Asia/Dubai': [25.2, 55.27],
    'Asia/Kolkata': [28.61, 77.21], 'Asia/Calcutta': [28.61, 77.21], 'Asia/Shanghai': [31.23, 121.47], 'Asia/Tokyo': [35.68, 139.69], 'Asia/Seoul': [37.57, 126.98],
    'Asia/Singapore': [1.35, 103.82], 'Asia/Hong_Kong': [22.32, 114.17], 'Australia/Sydney': [-33.87, 151.21], 'Australia/Melbourne': [-37.81, 144.96],
    'Australia/Perth': [-31.95, 115.86], 'Pacific/Auckland': [-36.85, 174.76],
  };

  // more zones, as "zone,lat,lon" (main city of each)
  const MORE = (
    'America/Anchorage,61.22,-149.9;America/Phoenix,33.45,-112.07;America/Detroit,42.33,-83.05;America/Indiana/Indianapolis,39.77,-86.16;America/Regina,50.45,-104.62;' +
    'America/Moncton,46.09,-64.78;America/Havana,23.13,-82.38;America/Jamaica,18.0,-76.8;America/Panama,8.98,-79.52;America/Costa_Rica,9.93,-84.08;America/Guatemala,14.63,-90.51;' +
    'America/El_Salvador,13.69,-89.19;America/Tegucigalpa,14.07,-87.19;America/Managua,12.13,-86.25;America/Puerto_Rico,18.47,-66.11;America/Santo_Domingo,18.49,-69.93;' +
    'America/Caracas,10.48,-66.9;America/Guayaquil,-2.17,-79.92;America/La_Paz,-16.5,-68.15;America/Asuncion,-25.26,-57.58;America/Montevideo,-34.9,-56.16;' +
    'America/Argentina/Cordoba,-31.42,-64.18;America/Manaus,-3.12,-60.02;America/Bahia,-12.97,-38.51;America/Fortaleza,-3.73,-38.53;America/Recife,-8.05,-34.88;' +
    'America/Tijuana,32.51,-117.04;America/Monterrey,25.69,-100.32;America/Cancun,21.16,-86.85;America/Guyana,6.8,-58.16;America/Paramaribo,5.85,-55.2;America/Nuuk,64.18,-51.72;' +
    'America/Whitehorse,60.72,-135.06;America/Yellowknife,62.45,-114.37;America/Iqaluit,63.75,-68.52;America/Boise,43.62,-116.2;' +
    'Pacific/Honolulu,21.31,-157.86;Pacific/Fiji,-18.14,178.44;Pacific/Guam,13.44,144.79;Pacific/Port_Moresby,-9.44,147.18;Pacific/Tahiti,-17.53,-149.57;' +
    'Pacific/Noumea,-22.28,166.46;Pacific/Tongatapu,-21.14,-175.2;Pacific/Apia,-13.83,-171.76;' +
    'Atlantic/Reykjavik,64.15,-21.94;Atlantic/Azores,37.74,-25.67;Atlantic/Madeira,32.65,-16.91;Atlantic/Bermuda,32.29,-64.78;Atlantic/Cape_Verde,14.93,-23.51;' +
    'Europe/Belgrade,44.8,20.46;Europe/Budapest,47.5,19.04;Europe/Prague,50.08,14.44;Europe/Bucharest,44.43,26.1;Europe/Sofia,42.7,23.32;Europe/Kyiv,50.45,30.52;Europe/Kiev,50.45,30.52;' +
    'Europe/Minsk,53.9,27.57;Europe/Riga,56.95,24.11;Europe/Tallinn,59.44,24.75;Europe/Vilnius,54.69,25.28;Europe/Copenhagen,55.68,12.57;Europe/Zagreb,45.81,15.98;' +
    'Europe/Ljubljana,46.06,14.51;Europe/Bratislava,48.15,17.11;Europe/Luxembourg,49.61,6.13;Europe/Malta,35.9,14.51;Europe/Monaco,43.74,7.42;Europe/Andorra,42.51,1.52;' +
    'Europe/Tirane,41.33,19.82;Europe/Sarajevo,43.86,18.41;Europe/Skopje,42.0,21.43;Europe/Chisinau,47.01,28.86;Europe/Samara,53.2,50.15;Europe/Kaliningrad,54.71,20.51;' +
    'Europe/Volgograd,48.71,44.51;Europe/Gibraltar,36.14,-5.35;' +
    'Asia/Karachi,24.86,67.0;Asia/Dhaka,23.81,90.41;Asia/Kathmandu,27.72,85.32;Asia/Colombo,6.93,79.86;Asia/Bangkok,13.76,100.5;Asia/Ho_Chi_Minh,10.82,106.63;' +
    'Asia/Jakarta,-6.21,106.85;Asia/Manila,14.6,120.98;Asia/Kuala_Lumpur,3.14,101.69;Asia/Taipei,25.03,121.57;Asia/Tehran,35.69,51.39;Asia/Baghdad,33.31,44.36;' +
    'Asia/Riyadh,24.71,46.68;Asia/Jerusalem,31.77,35.22;Asia/Beirut,33.89,35.5;Asia/Amman,31.95,35.93;Asia/Kuwait,29.38,47.99;Asia/Qatar,25.29,51.53;Asia/Baku,40.41,49.87;' +
    'Asia/Tbilisi,41.72,44.79;Asia/Yerevan,40.18,44.51;Asia/Tashkent,41.3,69.24;Asia/Almaty,43.24,76.89;Asia/Kabul,34.53,69.17;Asia/Yangon,16.87,96.2;Asia/Ulaanbaatar,47.89,106.91;' +
    'Asia/Novosibirsk,55.03,82.92;Asia/Yekaterinburg,56.84,60.6;Asia/Krasnoyarsk,56.01,92.85;Asia/Irkutsk,52.29,104.3;Asia/Vladivostok,43.12,131.89;Asia/Muscat,23.59,58.41;' +
    'Asia/Pyongyang,39.04,125.76;Asia/Phnom_Penh,11.56,104.92;' +
    'Africa/Casablanca,33.57,-7.59;Africa/Algiers,36.75,3.06;Africa/Tunis,36.81,10.18;Africa/Tripoli,32.89,13.19;Africa/Nairobi,-1.29,36.82;Africa/Addis_Ababa,9.03,38.74;' +
    'Africa/Accra,5.6,-0.19;Africa/Dakar,14.72,-17.47;Africa/Abidjan,5.36,-4.01;Africa/Kinshasa,-4.44,15.27;Africa/Luanda,-8.84,13.23;Africa/Maputo,-25.97,32.57;' +
    'Africa/Harare,-17.83,31.05;Africa/Dar_es_Salaam,-6.79,39.21;Africa/Kampala,0.35,32.58;Africa/Khartoum,15.5,32.56;Africa/Windhoek,-22.56,17.08;' +
    'Indian/Mauritius,-20.16,57.5;Indian/Maldives,4.18,73.51;' +
    'Australia/Brisbane,-27.47,153.03;Australia/Adelaide,-34.93,138.6;Australia/Darwin,-12.46,130.84;Australia/Hobart,-42.88,147.33;' +
    'Antarctica/McMurdo,-77.85,166.67;Arctic/Longyearbyen,78.22,15.65'
  ).split(';');
  MORE.forEach((z) => { const a = z.split(','); ZONES[a[0]] = [parseFloat(a[1]), parseFloat(a[2])]; });

  function place(tz, date) {
    if (tz && ZONES[tz]) return ZONES[tz];
    // unknown zone: a mid-northern latitude, longitude from the standard (not daylight saving) clock offset
    const y = date.getFullYear();
    const std = Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset());
    return [45, -std / 60 * 15];
  }

  // Sunrise and sunset of the UTC day containing `day`, as timestamps; or 'night' / 'day' for polar night and midnight sun (NOAA solar equations).
  function riseSet(day, lat, lon) {
    const rad = Math.PI / 180;
    const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    const n = Math.floor((start - Date.UTC(day.getUTCFullYear(), 0, 1)) / 864e5) + 1;
    const g = 2 * Math.PI / 365 * (n - 1);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const c = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
    if (c > 1) return 'night';
    if (c < -1) return 'day';
    const ha = Math.acos(c) / rad;
    let rise = start + (720 - 4 * (lon + ha) - eq) * 60000;
    let set = start + (720 - 4 * (lon - ha) - eq) * 60000;
    if (set <= rise) set += 864e5;
    return { rise, set };
  }

  function isNight(when, tz) {
    const t = when instanceof Date ? when : new Date(when == null ? Date.now() : when);
    let zone = tz;
    if (zone === undefined) { try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { zone = null; } }
    const p = place(zone, t);
    for (const d of [-1, 0, 1]) {
      const r = riseSet(new Date(t.getTime() + d * 864e5), p[0], p[1]);
      if (r === 'night') return true;
      if (r === 'day') return false;
      if (t.getTime() >= r.rise && t.getTime() < r.set) return false;
    }
    return true;
  }

  return { isNight, riseSet, ZONES };
});
