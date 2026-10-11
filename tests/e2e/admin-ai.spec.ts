import { test, expect, type Page } from '@playwright/test';
import { mockAdminTrpc, defaultAiAdminConfig, TrpcMockError } from './support/trpcMock';

/** AI on, with the models a real server sends (the default mock leaves them null). */
const aiOn = {
  ...defaultAiAdminConfig,
  aiEnabled: true,
  enabled: true,
  pronunciation: true,
  image: true,
  mnemonic: true,
  mnemonicModel: 'gpt-5.6-luna',
  imageModel: 'gpt-image-1.5',
  imageQuality: 'low',
  ttsModel: 'gpt-4o-mini-tts',
};

/** The AI tab, with what Save sends recorded. */
async function openAiTab(page: Page, aiConfig: unknown, saveAdminConfig?: (input: Record<string, unknown>) => unknown): Promise<Record<string, unknown>[]> {
  const saved: Record<string, unknown>[] = [];
  await mockAdminTrpc(page, {
    aiConfig,
    mutations: {
      'ai.saveAdminConfig': (input: unknown) => {
        saved.push(input as Record<string, unknown>);
        return saveAdminConfig ? saveAdminConfig(input as Record<string, unknown>) : { success: true };
      },
    },
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'AI' }).click();
  return saved;
}

test.describe('admin panel — AI configuration', () => {
  test('"AI Configuration" heading is visible on AI tab', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'AI' }).click();

    await expect(page.getByText('AI Configuration')).toBeVisible();
  });

  test('"Configure AI-powered features" description text is visible', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'AI' }).click();

    await expect(
      page.getByText('Configure AI-powered features like pronunciation, image generation, and mnemonics.')
    ).toBeVisible();
  });

  test('"Enable AI Features" text is visible (master switch label)', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'AI' }).click();

    await expect(page.getByText('Enable AI Features')).toBeVisible();
  });

  test('"Save Configuration" button is visible', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'AI' }).click();

    await expect(page.getByRole('button', { name: 'Save Configuration' })).toBeVisible();
  });

  test('warning message is visible when AI is disabled (default)', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'AI' }).click();

    await expect(
      page.getByText(/AI features are currently disabled/i)
    ).toBeVisible();
  });

  test('OpenAI-compatible endpoint and optional API key fields are visible', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'AI' }).click();

    await expect(page.getByText('OpenAI-compatible API base URL', { exact: true })).toBeVisible();
    await expect(page.getByText('API Key (optional for custom endpoints)', { exact: true })).toBeVisible();
  });

  test('warning message is NOT visible when AI is enabled', async ({ page }) => {
    await mockAdminTrpc(page, {
      aiConfig: { ...defaultAiAdminConfig, aiEnabled: true, enabled: true },
    });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'AI' }).click();

    await expect(
      page.getByText(/AI features are currently disabled/i)
    ).not.toBeVisible();
  });

  test('"Pronunciation" feature text is visible when AI is enabled', async ({ page }) => {
    await mockAdminTrpc(page, {
      aiConfig: { ...defaultAiAdminConfig, aiEnabled: true, enabled: true },
    });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'AI' }).click();

    await expect(page.getByText('Pronunciation (Text-to-Speech)')).toBeVisible();
  });

  test('choosing "Anthropic (Claude)" for mnemonic suggestions shows the Anthropic API Key field', async ({ page }) => {
    await openAiTab(page, aiOn);

    const provider = page.getByLabel('Mnemonic suggestions use');
    await expect(provider).toBeVisible();
    await expect(provider).toHaveValue('openai');
    await expect(page.getByLabel('Anthropic API Key')).toHaveCount(0);

    await provider.selectOption({ label: 'Anthropic (Claude)' });
    await expect(page.getByLabel('Anthropic API Key')).toBeVisible();
    await expect(page.getByText('Your OpenAI model (gpt-5.6-luna) stays saved and comes back if you switch back.')).toBeVisible();
    await expect(page.getByText('Paste an Anthropic API key to use Claude — saving is refused without one.')).toBeVisible();
  });

  test('a saved Anthropic key shows as saved, with the Configured badge and Remove key', async ({ page }) => {
    await openAiTab(page, { ...aiOn, textProvider: 'anthropic', hasAnthropicKey: true });

    await expect(page.getByLabel('Mnemonic suggestions use')).toHaveValue('anthropic');
    const key = page.getByLabel('Anthropic API Key');
    await expect(key).toHaveValue('');
    await expect(key).toHaveAttribute('placeholder', /\(saved\)/);
    await expect(key.locator('..').getByText('Configured', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove key' })).toBeVisible();
  });

  test('"Test key" says the key works', async ({ page }) => {
    const tested: unknown[] = [];
    await mockAdminTrpc(page, {
      aiConfig: { ...aiOn, textProvider: 'anthropic', hasAnthropicKey: true },
      mutations: {
        'ai.testAnthropicKey': (input: unknown) => {
          tested.push(input);
          return { ok: true, checks: [{ model: 'claude-opus-5-5', servedModel: 'claude-opus-5-5', seconds: 1.2 }] };
        },
      },
    });
    await page.goto('/admin');
    await page.getByRole('button', { name: 'AI' }).click();

    await page.getByRole('button', { name: 'Test key' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Key works' })).toHaveText('Key works. Claude answered with claude-opus-5-5.');
    // The saved key: nothing typed goes to the server.
    expect(tested).toHaveLength(1);
    expect(tested[0]).toEqual({ mnemonicModel: 'claude-opus-5-5' });
  });

  test('Save sends Anthropic as the provider, the key only once one is typed, and clears it after', async ({ page }) => {
    const saved = await openAiTab(page, { ...aiOn, hasAnthropicKey: true });

    await page.getByLabel('Mnemonic suggestions use').selectOption('anthropic');
    await page.getByRole('button', { name: 'Save Configuration' }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toMatchObject({
      textProvider: 'anthropic',
      anthropicMnemonicModel: 'claude-opus-5-5',
      mnemonicModel: 'gpt-5.6-luna',
    });
    expect(saved[0]).not.toHaveProperty('anthropicApiKey');

    const key = page.getByLabel('Anthropic API Key');
    await key.fill('sk-ant-test');
    await page.getByRole('button', { name: 'Save Configuration' }).click();
    await expect.poll(() => saved.length).toBe(2);
    expect(saved[1]).toMatchObject({ anthropicApiKey: 'sk-ant-test' });
    // The refetched config is the same as before (React Query keeps the same object), yet the typed key is gone.
    await expect(page.getByText('Saved successfully')).toBeVisible();
    await expect(key).toHaveValue('');
  });

  test('a save the server refuses keeps the typed key and says why', async ({ page }) => {
    const message = '"gpt-5.6-luna" is not a Claude model id — pick a claude-* model for mnemonics';
    const saved = await openAiTab(page, aiOn, () => {
      throw new TrpcMockError(message, 'BAD_REQUEST', 400, 'TEXT_MODEL_PROVIDER_MISMATCH');
    });

    await page.getByLabel('Mnemonic suggestions use').selectOption('anthropic');
    await page.getByLabel('Anthropic API Key').fill('sk-ant-test');
    await page.getByRole('button', { name: 'Save Configuration' }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toMatchObject({ textProvider: 'anthropic', anthropicApiKey: 'sk-ant-test' });
    // Said in the admin's language by the server's code, not in the server's English.
    await expect(page.getByText('A model under “Model Settings” is for the other provider: Claude takes claude-* models, and OpenAI its own.')).toBeVisible();
    await expect(page.getByText(message)).toHaveCount(0);
    await expect(page.getByLabel('Anthropic API Key')).toHaveValue('sk-ant-test');
  });

  test('has no cognate controls (v1.20.0), and Save sends no cognate setting', async ({ page }) => {
    // An older server's answer still carries the cognate switch and models: none of it shows.
    const saved = await openAiTab(page, { ...aiOn, cognate: true, cognateModel: 'gpt-4o-mini', anthropicCognateModel: 'claude-haiku-5-5' });

    await page.getByRole('button', { name: /Model Settings/ }).click();
    for (const provider of ['openai', 'anthropic']) {
      await page.getByLabel('Mnemonic suggestions use').selectOption(provider);
      await expect(page.getByLabel('Mnemonic model')).toBeVisible();
      await expect(page.getByText(/cognate/i)).toHaveCount(0);
      await expect(page.getByLabel(/cognate/i)).toHaveCount(0);
    }

    await page.getByLabel('Mnemonic suggestions use').selectOption('openai');
    await page.getByRole('button', { name: 'Save Configuration' }).click();
    await expect.poll(() => saved.length).toBe(1);
    for (const key of ['cognate', 'cognateModel', 'anthropicCognateModel']) expect(saved[0]).not.toHaveProperty(key);
  });
});
