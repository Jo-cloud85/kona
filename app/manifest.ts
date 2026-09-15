import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kona',
    short_name: 'Kona',
    description: 'Your AI endurance companion.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0b10',
    theme_color: '#0b0b10',
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
