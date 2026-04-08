/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './admin.html', './agency/index.html', './src/**/*.{ts,tsx}'],
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
        display: ['"Cormorant Garamond"', 'serif'],
        body: ['"Manrope"', 'sans-serif']
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(158, 255, 0, 0.5), 0 10px 30px rgba(158, 255, 0, 0.2)'
      }
    }
  },
  plugins: []
};
