# pi-multi-account

Multiple Claude and ChatGPT accounts per provider in [Pi](https://pi.dev).

Every extra account is Pi's own provider under a new id (`anthropic-account-2`,
`openai-account-2`, …). Logging in, token refresh, request handling and the model list are
all Pi's — this extension only adds the accounts. It uses official Pi APIs only.

## Install

```bash
pi install git:github.com/kacperkwapisz/pi-multi-account
```

Requires Pi 1.x.

## Use

```text
/accounts
```

Opens a view with a tab per provider (Anthropic, OpenAI):

- **Enter on an account** switches to it, keeping your model when that account offers it.
- **Enter on "+ Add account"** puts `/login <next free account>` in the editor — press Enter
  and Pi's own login takes over.
- Accounts that need logging in again are marked; Enter starts the login.

You can also use Pi directly: `/login` lists the next free account of each provider, and
`/logout` removes one.

ChatGPT accounts use Pi's **Sign in with ChatGPT** (`openai` provider).

## Automatic switching

When an account hits its usage limit (or its login stops working) in the middle of a task,
Pi moves to the next account of the same provider and carries on with the same model:

```text
Anthropic account 1 hit its usage limit (resets in 2h 14m). Continuing on account 2.
```

- It works like Pi's own retry: the failed attempt is hidden from the model and the next
  request goes to the other account. Nothing is re-sent or lost.
- Only account problems switch accounts. Overloaded servers, network errors and full context
  windows stay with Pi's own retries and compaction.
- An account that hit its limit is skipped until it resets (the time the provider reports,
  otherwise 15 minutes), and `/accounts` shows when. Choosing it in `/accounts` uses it anyway.
- When every account is at its limit, Pi stops and tells you which one resets first.

## Usage limits

See every account's usage with
[pi-subscription-usage](https://github.com/kacperkwapisz/pi-subscription-usage); it picks up
these accounts automatically.

## Development

```bash
npm install
npm run check
npm test
```
