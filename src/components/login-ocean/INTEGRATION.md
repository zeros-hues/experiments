# Mounting OceanScene behind the admin login card

This is the integration pattern only, assuming a typical centered-card
login layout. It is not a replacement login page; keep your existing form
component and auth logic untouched and wrap them in this structure.

## Packages

```
npm install three @react-three/fiber @react-three/drei postprocessing @react-three/postprocessing
```

(`@react-three/drei` is not imported by the current code but is safe to
have installed for future tweaks; the other four are required.)

## The pattern

```tsx
// app/admin/login/page.tsx (Server Component; adapt paths to your app)
import { OceanScene } from '@/components/login-ocean/OceanScene';
import { formatDateKey } from '@/lib/login-ocean/dateState';

// The date must be computed per request, never at build time, or every
// visitor gets the fish count from the day the page was last built.
export const dynamic = 'force-dynamic';

export default function AdminLoginPage() {
  const dateKey = formatDateKey(new Date());

  return (
    <main className="relative min-h-screen bg-[#0A0B0D]">
      {/* Layer 1: the ocean. Fixed, full viewport, behind everything.
          The component is aria-hidden and pointer-events: none
          internally; z-0 here plus z-10 on the content is all the
          stacking it needs. */}
      <OceanScene dateKey={dateKey} className="fixed inset-0 z-0" />

      {/* Layer 2: the scrim. A radial darkening centered where the card
          sits, so the cream card keeps contrast against both the busy
          1 January swarm and the sparse 31 December whale. It grades to
          transparent at the edges so the scene stays vivid around the
          card instead of being dimmed wholesale. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0
                   bg-[radial-gradient(ellipse_55%_65%_at_50%_50%,rgba(10,11,13,0.55),rgba(10,11,13,0.20)_60%,transparent_100%)]"
      />

      {/* Layer 3: the login card. Your existing form goes inside; the
          surface token at ~92% opacity plus a light backdrop blur keeps
          text legible while letting the water breathe through the
          edges. Warm brown shadow from the existing token set. */}
      <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <div
          className="w-full max-w-sm rounded-2xl bg-[#FBF8F2]/[0.92] p-8
                     shadow-[0_24px_64px_rgba(42,31,20,0.45)] backdrop-blur-md"
        >
          {/* <YourExistingLoginForm /> */}
        </div>
      </div>
    </main>
  );
}
```

## Notes

- **Client-only variant**: omit `dateKey` and drop `force-dynamic`;
  OceanScene then reads the visitor's clock on mount. The server-prop
  version exists to avoid a first-paint flash and to keep server and
  client agreeing on the day.
- **Legibility in both extremes**: January is busy but the swarm is
  mid-gray on near-black, so the radial scrim's 55% center is enough;
  December is nearly empty and *dark*, which is why the card carries its
  own high-opacity cream surface rather than relying on contrast with
  the scene. Test both by faking the system date.
- **Focus order**: OceanScene contributes nothing focusable, so the
  first Tab on the page lands on the username field with no changes on
  your part.
- **Day-counter readout** (not included, per spec): if wanted later, it
  goes bottom-left of the viewport, outside the card, as a Martian Mono
  uppercase micro-label ("DAY 186 / 365") in `#B8B6AE` at ~11px with
  wide tracking, `aria-hidden`, positioned `fixed left-6 bottom-6 z-10`.
  Ask and it can be wired to `getOceanDayState` in one small component.
