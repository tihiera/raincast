/** SVG icon inner content for 16x16 viewBox doodles */
const DOODLE_ICONS: string[] = [
  // star
  `<path d="M8 1l2 5h5l-4 3 1.5 5L8 11l-4.5 3L5 9 1 6h5z"/>`,
  // heart
  `<path d="M8 14s-6-4-6-8a3.5 3.5 0 017 0 3.5 3.5 0 017 0c0 4-6 8-6 8z"/>`,
  // smiley
  `<circle cx="8" cy="8" r="7" fill="none"/><circle cx="5.5" cy="6.5" r="1"/><circle cx="10.5" cy="6.5" r="1"/><path d="M5 10a3.5 3.5 0 006 0" fill="none"/>`,
  // lightning
  `<path d="M9 1L3 9h5l-1 6 6-8H8z"/>`,
  // cloud
  `<path d="M4 12a3 3 0 01-.5-6 4.5 4.5 0 018.5-1 3 3 0 01.5 6z" fill="none"/>`,
  // sun
  `<circle cx="8" cy="8" r="3" fill="none"/><path d="M8 2v-1m0 14v-1m-6-6H1m14 0h-1m-1.5-4.5l-.7.7M4.2 11.8l-.7.7m0-9l.7.7m7.6 7.6l.7.7"/>`,
  // moon
  `<path d="M12 3a6 6 0 100 10A5 5 0 0112 3z" fill="none"/>`,
  // music note
  `<path d="M6 14V4l8-3v10" fill="none"/><circle cx="4" cy="13" r="2" fill="none"/><circle cx="12" cy="11" r="2" fill="none"/>`,
  // envelope
  `<rect x="1" y="3" width="14" height="10" rx="1.5" fill="none"/><path d="M1 4l7 5 7-5" fill="none"/>`,
  // globe
  `<circle cx="8" cy="8" r="6.5" fill="none"/><path d="M1.5 8h13M8 1.5v13" fill="none"/><ellipse cx="8" cy="8" rx="3" ry="6.5" fill="none"/>`,
  // code
  `<path d="M5 4L1 8l4 4m6-8l4 4-4 4" fill="none"/>`,
  // camera
  `<rect x="1" y="4" width="14" height="10" rx="2" fill="none"/><circle cx="8" cy="9.5" r="3" fill="none"/><path d="M5 4l1-2h4l1 2"/>`,
  // diamond
  `<path d="M8 1l7 7-7 7-7-7z" fill="none"/>`,
  // flower
  `<circle cx="8" cy="8" r="2"/><circle cx="8" cy="4" r="2.5" fill="none"/><circle cx="8" cy="12" r="2.5" fill="none"/><circle cx="4" cy="6" r="2.5" fill="none"/><circle cx="12" cy="6" r="2.5" fill="none"/><circle cx="4" cy="10" r="2.5" fill="none"/><circle cx="12" cy="10" r="2.5" fill="none"/>`,
  // rocket
  `<path d="M8 14c-1-3-1-7 0-10a6 6 0 014 6l-2 2m-4 0a6 6 0 01-4-6l2-2" fill="none"/>`,
  // bulb
  `<path d="M6 14h4m-4-2h4" fill="none"/><path d="M5 9a4 4 0 116 0c0 1.5-1 2-1 3H6c0-1-1-1.5-1-3z" fill="none"/>`,
  // bell
  `<path d="M3 10a5 5 0 0110 0v1H3z" fill="none"/><path d="M2 11h12" fill="none"/><path d="M7 13a1.5 1.5 0 003 0"/>`,
  // crown
  `<path d="M2 12l2-7 4 4 4-4 2 7z" fill="none"/>`,
  // paper plane
  `<path d="M1 7l14-5-5 14-3-6z" fill="none"/><path d="M10 6l-4 3"/>`,
  // key
  `<circle cx="5" cy="5" r="3.5" fill="none"/><path d="M7.5 7.5L14 14m-2-2v2h2"/>`,
  // leaf
  `<path d="M3 14C3 7 7 3 14 2c0 7-4 11-11 12z" fill="none"/><path d="M3 14C7 10 10 6 14 2" fill="none"/>`,
  // hashtag
  `<path d="M4 1l-1 14m8-14l-1 14M1 5h14M1 11h14" fill="none"/>`,
  // puzzle
  `<path d="M3 8V3h5a2 2 0 014 0h4v5a2 2 0 010 4v4H3v-4a2 2 0 010-4z" fill="none"/>`,
  // sparkle 4-point
  `<path d="M8 1c0 3-1 6-7 7 6 1 7 4 7 7 0-3 1-6 7-7-6-1-7-4-7-7z"/>`,
  // palette
  `<path d="M8 1a7 7 0 000 14c1 0 2-1 2-2 0-.5-.2-1-.5-1.3-.3-.3-.5-.8-.5-1.2 0-1 .8-1.5 1.5-1.5H12a5 5 0 005-5C17 2 13 1 8 1z" fill="none"/><circle cx="5" cy="5.5" r="1"/><circle cx="8" cy="3.5" r="1"/><circle cx="11" cy="5.5" r="1"/><circle cx="5" cy="9" r="1"/>`,
  // game controller
  `<rect x="1" y="4" width="14" height="8" rx="3" fill="none"/><path d="M5 6v4m-2-2h4"/><circle cx="11" cy="7" r="0.8"/><circle cx="13" cy="9" r="0.8"/>`,
  // wifi
  `<circle cx="8" cy="13" r="1"/><path d="M5 11a4 4 0 016 0" fill="none"/><path d="M2 8a8 8 0 0112 0" fill="none"/>`,
  // pin
  `<path d="M8 15S2 9.5 2 6a6 6 0 0112 0c0 3.5-6 9-6 9z" fill="none"/><circle cx="8" cy="6" r="2" fill="none"/>`,
  // scissors
  `<circle cx="4" cy="4" r="2.5" fill="none"/><circle cx="4" cy="12" r="2.5" fill="none"/><path d="M14 2L6 9m0-2l8 7"/>`,
  // book
  `<path d="M2 2c3-1 5 0 6 1 1-1 3-2 6-1v12c-3-1-5 0-6 1-1-1-3-2-6-1z" fill="none"/><path d="M8 3v12"/>`,
];

export default DOODLE_ICONS;
