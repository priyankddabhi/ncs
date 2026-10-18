/** Side-panel help: "What the numbers mean" (folded; same wording as the Python page) and the disclaimer. */
import { PlusIcon } from "./Icons.tsx";

export function Glossary() {
  return (
    <details className="acc">
      <summary>
        <span>What the numbers mean</span>
        <PlusIcon className="accIcon" />
      </summary>
      <ul className="gloss">
        <li><b>Return</b> = how much a trade gained or lost, in %, after costs: (sell price − buy price) ÷ buy price. Example: +1.60% on ₹1,00,000 = <b>₹1,600 profit</b>.</li>
        <li><b>%/trade</b> = the average return of all past trades of that rule since 2010, after a 0.1% cost.</li>
        <li><b>% win / % profitable</b> = how many of those past trades ended in profit.</li>
        <li><b>Trades</b> = how many past trades the numbers come from (more = more reliable; under 20 is not used).</li>
        <li><b>Past trades like this</b> = what happened after the same signal since 2010, sold the same way. <b>Usually</b> = the middle trade (median). <b>Range</b> = the middle half of those trades (a quarter did worse, a quarter did better). The prices are that range applied to today&apos;s price (or to your buy price). It is history, not a promise.</li>
        <li><b>Market alone</b> = buying on any day and holding for the same time. A rule is only used if it beat this since 2010 <b>and</b> since 2019 (so a lucky old winner is dropped). Each market gets its own rules.</li>
        <li><b>Filters</b> = extra checks a rule must pass (volume above its 30-day average, or the daily / weekly / monthly trend UP). Each is used only where the test showed it helped.</li>
        <li><b>% so far</b> = your own trade: today&apos;s price vs your buy price.</li>
        <li><b>Live</b> = the market is still open, so the signal can change before the close. <b>Confirmed</b> = decided on the closing price.</li>
      </ul>
    </details>
  );
}

export function Disclaimer() {
  return (
    <p className="disclaimer">
      Past results (2010 to today, 0.1% cost per trade) do not promise future results. Crude signals use Brent in US$.
      For learning and paper trading, not financial advice.
    </p>
  );
}
