import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { createAgentApp } from '@lucid-agents/hono';
import { payments, paymentsFromEnv } from '@lucid-agents/payments';
import { analytics, getSummary, getAllTransactions, exportToCSV } from '@lucid-agents/analytics';
import { z } from 'zod';

const agent = await createAgent({
  name: 'timezone-intel',
  version: '1.0.0',
  description: 'Real-time timezone intelligence: current times, timezone conversions, holiday calendars, and DST info. Essential data for scheduling agents.',
})
  .use(http())
  .use(payments({ config: paymentsFromEnv() }))
  .use(analytics())
  .build();

const { app, addEntrypoint } = await createAgentApp(agent);

// === HELPER: Fetch JSON from API ===
async function fetchJSON(url: string) {
  const response = await fetch(url, { 
    headers: { 'User-Agent': 'timezone-intel/1.0' }
  });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// === FREE ENDPOINT: Overview ===
addEntrypoint({
  key: 'overview',
  description: 'Free overview - sample timezones and countries available',
  input: z.object({}),
  price: { amount: 0 },
  handler: async () => {
    const [timezones, countries] = await Promise.all([
      fetchJSON('https://timeapi.io/api/timezone/availabletimezones'),
      fetchJSON('https://date.nager.at/api/v3/AvailableCountries'),
    ]);
    
    // Sample major timezones
    const majorZones = [
      'America/New_York', 'America/Los_Angeles', 'America/Chicago',
      'Europe/London', 'Europe/Paris', 'Europe/Berlin',
      'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore',
      'Australia/Sydney', 'Pacific/Auckland'
    ];
    
    return {
      output: {
        totalTimezones: timezones.length,
        sampleTimezones: majorZones,
        totalCountries: countries.length,
        sampleCountries: countries.slice(0, 10),
        endpoints: {
          'current-time': 'Get current time in any timezone ($0.001)',
          'convert': 'Convert time between timezones ($0.002)',
          'holidays': 'Get holidays for country/year ($0.002)',
          'multi-zone': 'Current time in multiple zones ($0.003)',
          'full-report': 'Complete timezone report ($0.005)',
        },
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID ENDPOINT 1 ($0.001): Current Time ===
addEntrypoint({
  key: 'current-time',
  description: 'Get current time in any timezone with DST info',
  input: z.object({
    timezone: z.string().describe('IANA timezone (e.g., America/New_York, Europe/London)'),
  }),
  price: { amount: 1000 },
  handler: async (ctx) => {
    const data = await fetchJSON(
      `https://timeapi.io/api/time/current/zone?timeZone=${encodeURIComponent(ctx.input.timezone)}`
    );
    
    return {
      output: {
        timezone: data.timeZone,
        dateTime: data.dateTime,
        date: data.date,
        time: data.time,
        dayOfWeek: data.dayOfWeek,
        dstActive: data.dstActive,
        year: data.year,
        month: data.month,
        day: data.day,
        hour: data.hour,
        minute: data.minute,
        seconds: data.seconds,
      },
    };
  },
});

// === PAID ENDPOINT 2 ($0.002): Convert Time ===
addEntrypoint({
  key: 'convert',
  description: 'Convert a specific time from one timezone to another',
  input: z.object({
    fromTimezone: z.string().describe('Source timezone (e.g., America/New_York)'),
    toTimezone: z.string().describe('Target timezone (e.g., Europe/London)'),
    dateTime: z.string().describe('DateTime to convert (format: 2026-02-01 10:00:00)'),
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const response = await fetch('https://timeapi.io/api/conversion/converttimezone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromTimeZone: ctx.input.fromTimezone,
        dateTime: ctx.input.dateTime,
        toTimeZone: ctx.input.toTimezone,
        dstAmbiguity: '',
      }),
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    
    return {
      output: {
        original: {
          timezone: data.fromTimezone,
          dateTime: data.fromDateTime,
        },
        converted: {
          timezone: data.toTimeZone,
          dateTime: data.conversionResult?.dateTime,
          date: data.conversionResult?.date,
          time: data.conversionResult?.time,
          dayOfWeek: data.conversionResult?.dayOfWeek,
          dstActive: data.conversionResult?.dstActive,
        },
      },
    };
  },
});

// === PAID ENDPOINT 3 ($0.002): Holidays ===
addEntrypoint({
  key: 'holidays',
  description: 'Get public holidays for a country and year',
  input: z.object({
    countryCode: z.string().length(2).describe('ISO 3166-1 alpha-2 country code (e.g., US, GB, DE)'),
    year: z.number().optional().describe('Year (defaults to current year)'),
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const year = ctx.input.year || new Date().getFullYear();
    const data = await fetchJSON(
      `https://date.nager.at/api/v3/publicholidays/${year}/${ctx.input.countryCode.toUpperCase()}`
    );
    
    const holidays = data.map((h: any) => ({
      date: h.date,
      name: h.name,
      localName: h.localName,
      isGlobal: h.global,
      types: h.types,
    }));
    
    return {
      output: {
        countryCode: ctx.input.countryCode.toUpperCase(),
        year,
        totalHolidays: holidays.length,
        holidays,
      },
    };
  },
});

// === PAID ENDPOINT 4 ($0.003): Multi-Zone ===
addEntrypoint({
  key: 'multi-zone',
  description: 'Get current time in multiple timezones at once',
  input: z.object({
    timezones: z.array(z.string()).min(2).max(10).describe('Array of IANA timezones'),
  }),
  price: { amount: 3000 },
  handler: async (ctx) => {
    const results = await Promise.all(
      ctx.input.timezones.map(async (tz) => {
        try {
          const data = await fetchJSON(
            `https://timeapi.io/api/time/current/zone?timeZone=${encodeURIComponent(tz)}`
          );
          return {
            timezone: tz,
            dateTime: data.dateTime,
            date: data.date,
            time: data.time,
            dayOfWeek: data.dayOfWeek,
            dstActive: data.dstActive,
          };
        } catch (e) {
          return { timezone: tz, error: 'Failed to fetch' };
        }
      })
    );
    
    return {
      output: {
        count: results.length,
        times: results,
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID ENDPOINT 5 ($0.005): Full Report ===
addEntrypoint({
  key: 'full-report',
  description: 'Complete timezone report: current time, upcoming holidays, and next DST change',
  input: z.object({
    timezone: z.string().describe('IANA timezone (e.g., America/New_York)'),
    countryCode: z.string().length(2).describe('ISO country code for holidays (e.g., US)'),
  }),
  price: { amount: 5000 },
  handler: async (ctx) => {
    const year = new Date().getFullYear();
    
    const [timeData, holidays] = await Promise.all([
      fetchJSON(`https://timeapi.io/api/time/current/zone?timeZone=${encodeURIComponent(ctx.input.timezone)}`),
      fetchJSON(`https://date.nager.at/api/v3/publicholidays/${year}/${ctx.input.countryCode.toUpperCase()}`),
    ]);
    
    // Filter upcoming holidays
    const today = new Date().toISOString().split('T')[0];
    const upcomingHolidays = holidays
      .filter((h: any) => h.date >= today)
      .slice(0, 5)
      .map((h: any) => ({
        date: h.date,
        name: h.name,
        daysUntil: Math.ceil((new Date(h.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      }));
    
    return {
      output: {
        timezone: {
          name: ctx.input.timezone,
          currentTime: timeData.dateTime,
          date: timeData.date,
          time: timeData.time,
          dayOfWeek: timeData.dayOfWeek,
          dstActive: timeData.dstActive,
        },
        country: {
          code: ctx.input.countryCode.toUpperCase(),
          totalHolidays: holidays.length,
          upcomingHolidays,
        },
        generatedAt: new Date().toISOString(),
      },
    };
  },
});

// === ANALYTICS ENDPOINTS ===
addEntrypoint({
  key: 'analytics',
  description: 'Payment analytics summary',
  input: z.object({
    windowMs: z.number().optional().describe('Time window in ms'),
  }),
  price: { amount: 0 },
  handler: async (ctx) => {
    const tracker = agent.analytics?.paymentTracker;
    if (!tracker) {
      return { output: { error: 'Analytics not available' } };
    }
    const summary = await getSummary(tracker, ctx.input.windowMs);
    return {
      output: {
        ...summary,
        outgoingTotal: summary.outgoingTotal.toString(),
        incomingTotal: summary.incomingTotal.toString(),
        netTotal: summary.netTotal.toString(),
      },
    };
  },
});

addEntrypoint({
  key: 'analytics-transactions',
  description: 'Recent payment transactions',
  input: z.object({
    windowMs: z.number().optional(),
    limit: z.number().optional().default(50),
  }),
  price: { amount: 0 },
  handler: async (ctx) => {
    const tracker = agent.analytics?.paymentTracker;
    if (!tracker) {
      return { output: { transactions: [] } };
    }
    const txs = await getAllTransactions(tracker, ctx.input.windowMs);
    return { output: { transactions: txs.slice(0, ctx.input.limit) } };
  },
});

addEntrypoint({
  key: 'analytics-csv',
  description: 'Export payment data as CSV',
  input: z.object({ windowMs: z.number().optional() }),
  price: { amount: 0 },
  handler: async (ctx) => {
    const tracker = agent.analytics?.paymentTracker;
    if (!tracker) {
      return { output: { csv: '' } };
    }
    const csv = await exportToCSV(tracker, ctx.input.windowMs);
    return { output: { csv } };
  },
});

// === ERC-8004 Registration Endpoint ===
app.get('/.well-known/erc8004.json', (c) => {
  const baseUrl = process.env.AGENT_BASE_URL || 'https://timezone-intel-production.up.railway.app';
  return c.json({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'timezone-intel',
    description: 'Real-time timezone intelligence: current times, conversions, holiday calendars, DST info. Essential for scheduling agents. 1 free + 5 paid endpoints via x402.',
    image: `${baseUrl}/icon.png`,
    services: [
      { name: 'web', endpoint: baseUrl },
      { name: 'A2A', endpoint: `${baseUrl}/.well-known/agent.json`, version: '0.3.0' },
    ],
    x402Support: true,
    active: true,
    registrations: [],
    supportedTrust: ['reputation'],
  });
});

// Serve icon
app.get('/icon.png', async (c) => {
  try {
    const fs = await import('fs');
    const icon = fs.readFileSync('./icon.png');
    return new Response(icon, { headers: { 'Content-Type': 'image/png' } });
  } catch {
    return c.text('Icon not found', 404);
  }
});

const port = Number(process.env.PORT ?? 3000);
console.log(`🌍 Timezone Intel Agent running on port ${port}`);

export default { port, fetch: app.fetch };
