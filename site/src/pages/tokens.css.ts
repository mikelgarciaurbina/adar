// Publishes the design tokens the site is built on at tokens.css (offered on the design system page).
import tokens from '../styles/tokens.css?raw';

export const GET = () => new Response(tokens, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
