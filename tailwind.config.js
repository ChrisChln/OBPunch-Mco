/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './admin.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b0f14',
        paper: '#f2f5f7',
        neon: '#9eff00',
        ember: '#ff3b30',
        mint: '#16db65'
      },
      fontFamily: {
        display: ['"Bebas Neue"', 'sans-serif'],
        body: ['"Space Grotesk"', 'sans-serif']
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(158, 255, 0, 0.5), 0 10px 30px rgba(158, 255, 0, 0.2)'
      }
    }
  },
  plugins: []
};
