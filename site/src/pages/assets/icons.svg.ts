// Publishes the icon sprite at assets/icons.svg (the Icon component points <use> at it).
import sprite from '../../icons/icons.svg?raw';

export const GET = () => new Response(sprite, { headers: { 'Content-Type': 'image/svg+xml' } });
