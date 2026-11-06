import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useChats, resetChatsForTest } from '../src/assistant/chatStore';
import { mockConfig } from '../src/api/mock/config';
import { useApp } from '../src/state/store';
import { MenuBar } from '../src/ui/MenuBar';

// Mock pageBridge
vi.mock('../src/assistant/pageBridge', () => ({
  runPageSkill: vi.fn(() => false),
  insertFromChat: vi.fn(() => false),
  setPageHandlers: vi.fn(),
}));

// Capture originals before any test mutates them
const originalConfig = { ...mockConfig };

beforeEach(() => {
  mockConfig.swapMs = 0;
  mockConfig.loadMs = 0;
  mockConfig.tokenMinMs = 0;
  mockConfig.tokenMaxMs = 1;
  localStorage.clear();
  resetChatsForTest();
  vi.clearAllMocks();
});

afterEach(() => {
  mockConfig.swapMs = originalConfig.swapMs;
  mockConfig.loadMs = originalConfig.loadMs;
  mockConfig.tokenMinMs = originalConfig.tokenMinMs;
  mockConfig.tokenMaxMs = originalConfig.tokenMaxMs;
  cleanup();
});

describe('tokenStats store', () => {
  it('defaults to false and setTokenStats(true) persists to localStorage', () => {
    localStorage.clear();
    useApp.setState({ tokenStats: false });

    expect(useApp.getState().tokenStats).toBe(false);

    useApp.getState().setTokenStats(true);
    expect(useApp.getState().tokenStats).toBe(true);
    expect(localStorage.getItem('docuteach:v1:tokenStats')).toBe('true');
  });
});

describe('chatStore message stats', () => {
  it('send attaches stats to the assistant message only', async () => {
    await useChats.getState().init();
    const chatId = useChats.getState().activeId;

    await useChats.getState().send(chatId, 'What is gravity?');

    const chat = useChats.getState().chats.find((c) => c.id === chatId)!;
    expect(chat.messages[1].stats).toEqual({ in: 1240, out: 380, tps: 42 });
    expect(chat.messages[0].stats).toBeUndefined();
  });
});

describe('MenuBar token stats toggle', () => {
  it('Options menu shows group labels and token stats unchecked by default', () => {
    useApp.setState({ tokenStats: false });
    render(<MenuBar onAction={() => {}} />);

    fireEvent.click(screen.getByText('Options'));

    const menu = screen.getByRole('menu', { name: 'Options' });
    expect(menu).toBeDefined();

    expect(screen.getByText('Editor')).toBeDefined();
    expect(screen.getByText('Theme')).toBeDefined();
    expect(screen.getByText('Skills')).toBeDefined();
    expect(screen.getByText('Models')).toBeDefined();

    const checkbox = screen.getByRole('menuitemcheckbox', { name: /Show token stats/ });
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
  });

  it('clicking Show token stats toggles the store; reopened menu shows checked', async () => {
    useApp.setState({ tokenStats: false });
    render(<MenuBar onAction={() => {}} />);

    // Open menu and toggle
    fireEvent.click(screen.getByText('Options'));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Show token stats/ }));

    expect(useApp.getState().tokenStats).toBe(true);

    // Reopen the menu
    fireEvent.click(screen.getByText('Options'));
    const checkbox = await screen.findByRole('menuitemcheckbox', { name: /Show token stats/ });
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
  });
});
