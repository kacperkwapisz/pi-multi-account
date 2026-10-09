# pi-multi-account

Use more than one Claude or ChatGPT account in [Pi](https://pi.dev), and keep working when
one of them runs out.

Each extra account is a copy of Pi's own provider under a new id (`anthropic-account-2`,
`openai-account-2`). Pi still does the login, token refresh and requests. This extension only
adds the accounts and switches between them, using official Pi APIs.

## Install

```bash
pi install git:github.com/kacperkwapisz/pi-multi-account
```

Requires Pi 1.x.

## Add and switch accounts

Run `/accounts`. You get a tab for Anthropic and one for OpenAI, listing your accounts and
which one is in use. Select an account and press Enter to switch to it; your model stays the
same if that account has it. "+ Add account" puts `/login <next free account>` in the editor,
and Pi's normal login takes it from there. Accounts whose login stopped working are marked,
and Enter logs them in again.

Plain Pi works too: `/login` always lists the next free account of each provider, and
`/logout` removes one. ChatGPT accounts use Pi's Sign in with ChatGPT (the `openai` provider).

## When an account hits its limit

If an account runs out in the middle of a task, Pi moves to your next account and carries on
with the same model:

```text
Anthropic account 1 hit its usage limit (resets in 2h 14m). Continuing on account 2.
```

The failed attempt is dropped and the next request goes to the other account, the same way
Pi's own retry works, so nothing is lost or sent twice. A dead login is handled the same way.
Overloaded servers, network errors and full context windows are left to Pi, since another
account wouldn't help with those.

An account that hit its limit is skipped until it resets. ChatGPT says when in its limit error.
Claude doesn't, but every successful Claude request reports when the account's current limit
resets, so the last one seen is used. Without either (say, an account that failed on its first
request), it's 15 minutes. `/accounts` shows it, and picking the
account there uses it anyway. If every account is out, Pi stops and tells you which one
resets first.

## Usage

[pi-subscription-usage](https://github.com/kacperkwapisz/pi-subscription-usage) shows how much
of each account's limits you've used. It finds these accounts on its own, and when both are
installed you can switch accounts from its `/usage` view.

## For other extensions

Other extensions can switch accounts over Pi's `pi.events` bus, without depending on this
package:

```ts
let accounts: { version: 1; useAccount(providerId: string, ctx: ExtensionContext): Promise<boolean> } | undefined;
pi.events.emit("pi-multi-account:connect", { reply: (api) => (accounts = api) });
// Set right away when pi-multi-account is loaded, otherwise still undefined.
await accounts?.useAccount("anthropic-account-2", ctx);
```

`useAccount` works like picking the account in `/accounts`: it keeps the current model when
it can, asks which model to use when it can't, and ignores a recorded limit.

## Development

```bash
npm install
npm run check
npm test
```
