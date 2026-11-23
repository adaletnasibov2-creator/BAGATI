/**
 * Two-colour brand icons (DESIGN-POLISH-2, the owner's chosen drawings, viewBox 0 0 24 24). Colours come from the brand
 * tokens and render exactly as the mock: cream fill = gold-100 (#f3e9d5), outline = primary (#174746), accent =
 * gold-400 (#c79a52). Stroke 1.8. Always aria-hidden: the visible label (or the button's own label) names the control.
 *
 * `filled`: the heart's active state (favourites list not empty / product saved) = gold-400 at 35 % instead of cream.
 * `onDark`: for a green button: white outline, no cream fill, gold accent.
 */
type IconProps = { size?: number; className?: string; filled?: boolean; onDark?: boolean };

const outline = (onDark?: boolean) => (onDark ? "stroke-white" : "stroke-primary");
const body = (onDark?: boolean, filled?: boolean) => (onDark ? "fill-none" : filled ? "fill-gold-400 [fill-opacity:0.35]" : "fill-gold-100");

export function HeartIcon({ size = 30, className, filled = false, onDark = false }: IconProps) {
  return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} data-icon="heart" data-filled={filled ? "" : undefined}>
    <path d="M12 20.8s-7.2-4.5-9.6-9.1C.8 8.5 2.3 4.8 6 4.8c2.2 0 3.7 1.2 6 3.6 2.3-2.4 3.8-3.6 6-3.6 3.7 0 5.2 3.7 3.6 6.9-2.4 4.6-9.6 9.1-9.6 9.1z" className={`${body(onDark, filled)} ${outline(onDark)}`} strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M6.2 8.1c-.9.3-1.5 1.1-1.6 2.2" className="stroke-gold-400" strokeWidth="1.8" strokeLinecap="round" />
  </svg>;
}

export function BagIcon({ size = 30, className, onDark = false }: IconProps) {
  return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} data-icon="bag">
    <path d="M5.2 8.2h13.6l-1.1 11.3a1.6 1.6 0 0 1-1.6 1.4H7.9a1.6 1.6 0 0 1-1.6-1.4L5.2 8.2z" className={`${body(onDark)} ${outline(onDark)}`} strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M8.8 10.6V7.4a3.2 3.2 0 0 1 6.4 0v3.2" className={outline(onDark)} strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="14.6" r="1.3" className="fill-gold-400" />
  </svg>;
}

/** Guest "Giriş": head circle + shoulders in the same style (cream fill, green stroke 1.8, a small gold accent). */
export function UserIcon({ size = 30, className, onDark = false }: IconProps) {
  return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} data-icon="user">
    <circle cx="12" cy="8.4" r="3.9" className={`${body(onDark)} ${outline(onDark)}`} strokeWidth="1.8" />
    <path d="M4.6 20.2c.6-3.9 3.7-6.2 7.4-6.2s6.8 2.3 7.4 6.2" className={`${body(onDark)} ${outline(onDark)}`} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.3 7.3c.3-.7.9-1.1 1.7-1.2" className="stroke-gold-400" strokeWidth="1.8" strokeLinecap="round" />
  </svg>;
}
