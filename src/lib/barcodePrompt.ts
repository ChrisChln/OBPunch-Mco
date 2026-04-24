export type BarcodePromptGroupKey = 'morningStart' | 'morningFlow' | 'nightStart' | 'nightFinish' | 'weekend';

const BARCODE_PROMPTS: Record<BarcodePromptGroupKey, string[]> = {
  morningStart: [
    'The start of something great.',
    'Ready for a productive day?',
    'Fresh start. Fresh energy.',
    'Your morning shift is now active.',
    'Rise and shine.',
    'Let us make every scan count today.',
    'Morning, team.',
    'The warehouse comes alive with you.',
    'New day, new possibilities.',
    'Awaiting your first scan.',
    'Early morning momentum.',
    'Setting the pace for excellence.',
    'Good morning, leader.',
    'Ready to guide the flow?',
    'Capture the early light.',
    'Precision starts from the first minute.',
    'Your journey begins now.',
    'Let us hit those targets together.',
    'A blank canvas awaits.',
    'Write your success story today.'
  ],
  morningFlow: [
    'Stay in the flow.',
    'You are doing exceptional work.',
    'Keep the momentum going.',
    'Every scan is a step forward.',
    'Efficiency is an art.',
    'And you are the artist today.',
    'You are making it happen.',
    'The rhythm of success is steady.',
    'Stay focused, stay sharp.',
    'The afternoon peak is here.',
    'Productivity at its best.',
    'Almost through the first shift.',
    'The rhythm of the warehouse.',
    'Powered by your precision.',
    'Steady progress.',
    'Awaiting your next verification.',
    'Great work so far.',
    'Let us finish this shift strong.',
    'Mission in progress.',
    'Your contribution makes the difference.'
  ],
  nightStart: [
    'The world sleeps, we move.',
    'Night shift mode officially active.',
    'Handing over the torch.',
    'Let us keep the gears turning.',
    'Good evening, night shift.',
    'Ready to take the lead?',
    'The second wave begins.',
    'Strength and focus for the night.',
    'Steady and sure.',
    'Precision matters more in the quiet.',
    'The night belongs to us.',
    'Efficiency has no closing time.',
    'A different kind of energy.',
    'Welcome to the evening pulse.',
    'Ready for the night shift?',
    'Your station is waiting for you.',
    'Quiet power.',
    'The warehouse is in good hands tonight.',
    'Sunset productivity.',
    'Starting the night with excellence.'
  ],
  nightFinish: [
    'Night shift excellence.',
    'You are a legend in the making.',
    'Almost home.',
    'Stay sharp for the final stretch.',
    'The silence of high efficiency.',
    'Focus until the very last scan.',
    'Legendary work tonight.',
    'You kept the world moving.',
    'Quietly brilliant.',
    'Recording the final results of the day.',
    'Midnight momentum.',
    'Strong finish, well-deserved rest.',
    'Final lap.',
    'Ensure every detail is perfectly scanned.',
    'The gears never stop.',
    'Thank you for your dedication tonight.',
    'Rest is on the horizon.',
    'Just a few more steps to go.',
    'Mission accomplished.',
    'See you on the next journey.'
  ],
  weekend: [
    'The weekend warrior.',
    'Leading the way even today.',
    'A different pace.',
    'Calm, controlled, and efficient.',
    'The rhythm never stops.',
    'Weekend excellence in action.',
    'Saturday focus.',
    'Making the most of every moment.',
    'Sunday steady.',
    'Preparing the path for the week ahead.',
    'Dedication knows no days.',
    'Thank you for being here.',
    'Weekend flow active.',
    'Keeping the warehouse alive.',
    'Smooth scans, quiet days.',
    'Enjoy the weekend productivity.',
    'Exceptional effort.',
    'Your presence makes the difference.',
    'Ready for the weekend?',
    'Let us get this done beautifully.'
  ]
};

const toMinutes = (value: Date) => value.getHours() * 60 + value.getMinutes();

export const getBarcodePromptGroupKey = (value: Date): BarcodePromptGroupKey => {
  const day = value.getDay();
  if (day === 0 || day === 6) return 'weekend';

  const minutes = toMinutes(value);
  if (minutes >= 6 * 60 + 30 && minutes < 11 * 60 + 30) return 'morningStart';
  if (minutes >= 11 * 60 + 30 && minutes < 16 * 60 + 30) return 'morningFlow';
  if (minutes >= 16 * 60 + 30 && minutes < 21 * 60) return 'nightStart';
  if (minutes >= 21 * 60 || minutes < 6 * 60 + 30) return 'nightFinish';
  return 'morningStart';
};

export const getBarcodePrompts = (key: BarcodePromptGroupKey) => BARCODE_PROMPTS[key] ?? BARCODE_PROMPTS.morningStart;

export const getRandomBarcodePromptIndex = (key: BarcodePromptGroupKey) => {
  const prompts = getBarcodePrompts(key);
  return Math.floor(Math.random() * prompts.length);
};
