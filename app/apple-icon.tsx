import { ImageResponse } from 'next/og';
import { TriangleMark } from './brand-icon';

// iOS applies its own rounded-square mask on top of this — ship a full-bleed
// square with no pre-baked corner radius or transparency.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(circle at 20% 15%, rgba(168,85,247,0.35), transparent 60%), #0b0b10',
        }}
      >
        <div style={{ width: 132, height: 132, display: 'flex' }}>
          <TriangleMark />
        </div>
      </div>
    ),
    { ...size },
  );
}
