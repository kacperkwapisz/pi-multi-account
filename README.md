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
