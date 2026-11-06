import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SkillsDialog } from '../src/ui/dialogs/SkillsDialog';
import { ModelsDialog } from '../src/ui/dialogs/ModelsDialog';
import { api } from '../src/api';

afterEach(cleanup);

describe('SkillsDialog', () => {
  it('lists skills and deletes with Undo', async () => {
    await api.skills.save({ command: '/tmpx', name: 'Tmp', description: 'd', insertAs: 'text', body: 'b', tag: '' });
    const before = (await api.skills.manage()).length;
    render(<SkillsDialog open onClose={() => {}} />);
    const del = await screen.findAllByLabelText('Delete skill');
    fireEvent.click(del[0]);
    await waitFor(async () => expect((await api.skills.manage()).length).toBe(before - 1));
    fireEvent.click(await screen.findByText('Undo'));
    await waitFor(async () => expect((await api.skills.manage()).length).toBe(before));
  });

  it('opens the new-skill form', async () => {
    render(<SkillsDialog open onClose={() => {}} />);
    fireEvent.click(await screen.findByLabelText('New skill'));
    expect(await screen.findByLabelText('Command')).toBeTruthy();
    expect(screen.getByLabelText('Save skill')).toBeTruthy();
  });

  it('shows a placeholder template in the empty skill text box without filling it', async () => {
    render(<SkillsDialog open onClose={() => {}} />);
    fireEvent.click(await screen.findByLabelText('Import skill'));
    const box = (await screen.findByLabelText('Skill text')) as HTMLTextAreaElement;
    expect(box.value).toBe('');
    expect(box.placeholder).toContain('command: /mycommand');
    expect((screen.getByLabelText('Preview import') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('SkillsDialog slash command', () => {
  it('saves one leading slash and lists it without a double slash', async () => {
    render(<SkillsDialog open onClose={() => {}} />);
    fireEvent.click(await screen.findByLabelText('New skill'));
    fireEvent.change(await screen.findByLabelText('Command'), { target: { value: 'slashfix' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Slash fix' } });
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'b' } });
    fireEvent.click(screen.getByLabelText('Save skill'));
    await waitFor(async () =>
      expect((await api.skills.manage()).some((k) => k.command === '/slashfix')).toBe(true),
    );
    expect(await screen.findByText('/slashfix')).toBeTruthy();
    expect(screen.queryByText('//slashfix')).toBeNull();
    await api.skills.remove('/slashfix');
  });
});

describe('ModelsDialog', () => {
  it('lists models and sets default', async () => {
    render(<ModelsDialog open onClose={() => {}} />);
    const stars = await screen.findAllByLabelText('Set default');
    const enabled = stars.find((b) => !(b as HTMLButtonElement).disabled)!;
    fireEvent.click(enabled);
    await waitFor(async () => {
      const m = await api.models.manage();
      expect(m.models.filter((x) => x.isDefault).length).toBe(1);
      expect(m.models.find((x) => x.isDefault)!.id).not.toBe('qwen-27b');
    });
  });

  it('adds a model, then removes it with Undo', async () => {
    render(<ModelsDialog open onClose={() => {}} />);
    fireEvent.click(await screen.findByLabelText('Add model'));
    const id = await screen.findByLabelText(/^Id$|Model id/i);
    fireEvent.change(id, { target: { value: 'test-model' } });
    fireEvent.change(screen.getByLabelText(/path/i), { target: { value: 'C:/m.gguf' } });
    fireEvent.click(screen.getByLabelText(/^Save/));
    await waitFor(async () =>
      expect((await api.models.manage()).models.some((m) => m.id === 'test-model')).toBe(true));
    fireEvent.click(await screen.findByLabelText('Remove model'));
    await waitFor(async () =>
      expect((await api.models.manage()).models.some((m) => m.id === 'test-model')).toBe(false));
    fireEvent.click(await screen.findByText('Undo'));
    await waitFor(async () =>
      expect((await api.models.manage()).models.some((m) => m.id === 'test-model')).toBe(true));
  });
});

describe('ModelEditForm number display', () => {
  it('rounds float noise to 2 decimals', async () => {
    const { fmt2 } = await import('../src/ui/dialogs/ModelEditForm');
    expect(fmt2(0.30000000000000004)).toBe(0.3);
    expect(fmt2(0.95)).toBe(0.95);
    expect(fmt2(40)).toBe(40);
  });

  it('rounds once when filled from initial, so input and state agree', async () => {
    const { roundNums } = await import('../src/ui/dialogs/ModelEditForm');
    const f = roundNums({ temperature: 0.30000000000000004, top_p: 0.001 } as never);
    expect(f.temperature).toBe(0.3);
    expect(f.top_p).toBe(0);
  });
});
