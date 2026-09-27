# Checkout

Checkout turns a finished service into a paid ticket and feeds everything after it: technician pay, loyalty points and the end-of-day report.

![Checkout with an open ticket](../media/checkout.png)

## What it does

- **Start from the technician.** Pick who did the work, then the client. Today's waiting clients are listed first, and anyone else is one lookup away.
- **Build the ticket** from the salon's service menu and retail products, grouped the same way as the menu.
- **Adjust it:** tips, discounts, loyalty rewards, splitting one visit into several tickets or combining several into one.
- **Pay** by card on the salon's terminal, or record cash and other payments. Save and print sends the receipt to the salon's printer through a small Windows print agent.
- **Pending tickets and ticket history** let the desk pick up unpaid tickets or look up past ones.

## Engineering notes

**No lost tickets, no double charges.** A dropped connection at the worst moment, just after a card is charged, must not lose the ticket or charge twice:

- **Retries are safe.** Closing a ticket sends a unique idempotency key. If the same close arrives twice, the server replays its saved answer instead of closing the ticket again.
- **Payments are claimed once.** Each payment has a unique key in the database, so one card payment can't be counted toward two tickets.

**Every screen sees the same tickets.** The API runs on several server instances. When a ticket changes on one, it publishes the change through a Redis event bus, so screens connected to other instances update too.

**Busy moments don't flood the database.** When many screens refresh at once, requests for "today's tickets at this location" are merged into a single database read.

## Code in this repo

| File | What it does |
|---|---|
| [`checkout-event-bus.js`](../packages/checkout-sync/src/checkout-event-bus.js) | Publishes ticket changes across server instances, and skips an instance's own echoes |
| [`checkout-tickets-singleflight.js`](../packages/checkout-sync/src/checkout-tickets-singleflight.js) | Merges simultaneous ticket loads into one read |
| [`ticket-item-classification.js`](../packages/tickets/src/ticket-item-classification.js) | Decides whether each line is a service or a retail product |
| [`technician-compensation.js`](../packages/payroll/src/technician-compensation.js) | Commission rates and fees that turn tickets into pay |
| [`loyalty-core.js`](../packages/loyalty/src/loyalty-core.js) | Points earned and rewards redeemed at checkout |
