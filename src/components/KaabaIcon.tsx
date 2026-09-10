/**
 * The Kaaba, drawn rather than imported.
 *
 * This was the app's one Font Awesome icon, and carrying it meant carrying
 * Font Awesome's SVG core in the startup bundle — an icon framework, for one
 * icon, next to the two dozen in this app that are already plain inline SVG.
 *
 * Drawn in isometric rather than face-on: a flat elevation of a cube reads as
 * a shopfront at 20px, and the whole point of the shape is that it is a cube.
 * Top face and the two visible sides carry different weights of the same
 * `currentColor`, so it takes a text colour like every other icon here and
 * works on the light themes, the dark ones, and over the globe. The kiswah's
 * band and the door are cut clean through rather than painted a lighter
 * shade — at 20px a shade difference vanishes and a gap does not — and those
 * two are what make it the Kaaba rather than a box.
 */
export function KaabaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <mask id="kaaba-cutouts" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="#fff" />
        {/* Hollow the top face, so the cube reads as open-topped rather than
            as a solid blob at small sizes. */}
        <path d="M12 5.2 15.9 7.4 12 9.6 8.1 7.4Z" fill="#000" />
        {/* The door. */}
        <path d="M13.8 15.6 15.9 14.5 15.9 19.4 13.8 20.6Z" fill="#000" />
        {/* The kiswah's band, cut clean through both faces. Painted as a
            lighter fill it disappeared at 20px; as a gap it survives. */}
        <path d="M3.2 9.6 12 14.4 12 15.7 3.2 10.9Z" fill="#000" />
        <path d="M20.8 9.6 12 14.4 12 15.7 20.8 10.9Z" fill="#000" />
      </mask>
      <g mask="url(#kaaba-cutouts)">
        {/* Top face. */}
        <path d="M12 2.6 20.8 7.4 12 12.2 3.2 7.4Z" fill="currentColor" opacity="0.55" />
        {/* Left face, then right — two weights so they read as two planes. */}
        <path d="M3.2 7.4 12 12.2 12 21.6 3.2 16.8Z" fill="currentColor" />
        <path d="M20.8 7.4 12 12.2 12 21.6 20.8 16.8Z" fill="currentColor" opacity="0.78" />
      </g>
    </svg>
  );
}
