import { test, expect } from '@playwright/test';
import { mockAdminTrpc, mockAuthenticatedTrpc } from './support/trpcMock';

const openSizeTest = {
  id: 1,
  name: 'Tamaño y cobertura · Otoño',
  mode: 'size',
  occasion: 'Otoño 2026',
  settings: { bandCounts: [4, 4, 4, 4, 4], npseudo: 6, seed: 42 },
  closesAt: null,
  myAttempts: 0,
};

test.describe('vocabulómetro — student', () => {
  test('dashboard shows a banner when tests are open', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { vocabOpenTests: [openSizeTest] });

    await page.goto('/');

    await expect(page.getByText('1 prueba(s) de vocabulario abiertas para ti').or(
      page.getByText('1 vocabulary test(s) open for you')
    )).toBeVisible();
  });

  test('dashboard shows no banner when no tests are open', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { vocabOpenTests: [] });

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Your Decks' }).or(page.getByText('Tus mazos'))).toBeVisible();
    await expect(page.getByText(/vocabulary test\(s\) open|prueba\(s\) de vocabulario/)).toHaveCount(0);
  });

  test('student can open the vocabulómetro page and see available tests', async ({ page }) => {
    await mockAuthenticatedTrpc(page, { vocabOpenTests: [openSizeTest] });

    await page.goto('/vocabulometro');

    await expect(page.getByRole('heading', { name: 'Tamaño y cobertura · Otoño' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Start|Comenzar/ })).toBeVisible();
  });

  test('student can run a seeded size test to completion and results are submitted', async ({ page }) => {
    let submitted: unknown = null;
    await mockAuthenticatedTrpc(page, { vocabOpenTests: [openSizeTest] });
    await page.route('**/api/trpc/vocab.submitResult**', async (route, request) => {
      submitted = JSON.parse(request.postData() ?? 'null');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ result: { data: { id: 7 } } }]),
      });
    });

    await page.goto('/vocabulometro');
    await page.getByRole('button', { name: /Start|Comenzar/ }).click();

    // 4×5 real + 6 pseudo = 26 Sí/No items.
    // The runner ignores answers that land within 250ms of an item appearing
    // (the double-click / key-auto-repeat guard), so answer at human speed and
    // wait for the counter rather than clicking as fast as the driver can.
    for (let i = 0; i < 26; i += 1) {
      await expect(page.getByText(`${i + 1} / 26`)).toBeVisible();
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: /No/, exact: false }).last().click();
    }

    await expect(page.getByText('Resultados · Otoño 2026')).toBeVisible();
    await expect(page.getByText('tasa de falsa alarma')).toBeVisible();
    await expect(page.getByText('Resultado guardado en tu cuenta ✓')).toBeVisible();
    expect(submitted).not.toBeNull();
  });
});

test.describe('vocabulómetro — admin', () => {
  test('admin panel has a Vocabulómetro tab with test management', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Vocabulómetro' }).click();

    await expect(page.getByRole('button', { name: /New test|Nueva prueba/ })).toBeVisible();
    await expect(page.getByText(/No vocabulary tests configured yet|Todavía no hay pruebas de vocabulario/)).toBeVisible();
  });

  test('admin can open the create-test modal and see group + window controls', async ({ page }) => {
    await mockAdminTrpc(page);

    await page.goto('/admin?tab=vocab');
    await page.getByRole('button', { name: /New test|Nueva prueba/ }).click();

    await expect(page.getByText(/Occasion \(used to measure|Ocasión \(para medir/)).toBeVisible();
    await expect(page.getByText('Spanish Class')).toBeVisible();
    await expect(page.getByText(/Open for students|Abierta para estudiantes/)).toBeVisible();
    await expect(page.getByText(/Opens at|Abre el/)).toBeVisible();
  });

  test('admin sees configured tests with status toggle', async ({ page }) => {
    await mockAdminTrpc(page, {
      vocabTests: [{
        id: 1,
        name: 'Sondeo semana 3',
        mode: 's5000',
        occasion: 'Otoño 2026',
        settings: { blk: 3 },
        settingsJson: '{"blk":3}',
        isOpen: true,
        opensAt: null,
        closesAt: null,
        createdBy: 1,
        createdAt: '2026-07-01T00:00:00.000Z',
        groups: [{ id: 1, name: 'Spanish Class' }],
        resultCount: 12,
      }, {
        // isOpen but its window has not started: students cannot see it yet
        id: 2,
        name: 'Sondeo semana 9',
        mode: 's5000',
        occasion: 'Otoño 2026',
        settings: { blk: 3 },
        settingsJson: '{"blk":3}',
        isOpen: true,
        opensAt: '2099-01-01T15:00:00.000Z',
        closesAt: null,
        createdBy: 1,
        createdAt: '2026-07-01T00:00:00.000Z',
        groups: [{ id: 1, name: 'Spanish Class' }],
        resultCount: 0,
      }],
    });

    await page.goto('/admin?tab=vocab');

    await expect(page.getByRole('cell', { name: 'Sondeo semana 3', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Spanish Class' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Open|Abierta): (Close|Cerrar) [“«]Sondeo semana 3[”»]/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Scheduled|Programada) \((Opens|Abre el) .*2099.*\): (Close|Cerrar) [“«]Sondeo semana 9[”»]/ })).toBeVisible();
  });

  test('admin picks the professional clone as the Vocabulómetro voice and sees sentence readiness', async ({ page }) => {
    let saved: unknown = undefined;
    await mockAdminTrpc(page, {
      queries: {
        'vocab.getVocabVoice': {
          ttsProvider: 'elevenlabs', hasElevenLabsKey: true,
          vocabVoiceId: null, defaultVoiceId: 'voiceTeacherB', effectiveVoiceId: 'voiceTeacherB',
        },
        'ai.listTtsVoices': {
          configured: true,
          voices: [
            { voiceId: 'voiceTeacherB', name: 'Me', labels: {}, category: 'cloned' },
            { voiceId: 'voiceTeacherA', name: 'Teacher', labels: {}, category: 'professional' },
          ],
        },
        'vocab.getEiSentenceAudioStatus': { total: 16, ready: 12, readyIds: [] },
      },
      mutations: {
        'vocab.setVocabVoice': (input: unknown) => {
          saved = input;
          return { vocabVoiceId: (input as { voiceId: string | null }).voiceId };
        },
      },
    });

    await page.goto('/admin?tab=vocab');

    const voice = page.getByLabel(/^(Voice|Voz)$/);
    await expect(voice).toBeVisible();
    await expect(voice.locator('option', { hasText: /Teacher · (professional clone|clon profesional)/ })).toHaveCount(1);
    await voice.selectOption('voiceTeacherA');
    await expect.poll(() => saved).toEqual({ voiceId: 'voiceTeacherA' });
    await expect(page.getByText(/12 \/ 16 (sentences ready in this voice|frases listas con esta voz)/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Generate sentence audio|Generar audio de las frases)$/ })).toBeEnabled();
  });
});
