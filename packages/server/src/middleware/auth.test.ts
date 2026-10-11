// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { Request } from 'express';
import type { User } from '@libresrs/shared';
import {
  getSerializedUserId,
  getUser,
  requireAuth,
  requireAdmin,
  serializeUser,
  type AuthenticatedUser,
} from './auth';

function createMockRequest(user?: AuthenticatedUser): Request {
  return {
    user,
  } as unknown as Request;
}

const mockUser: AuthenticatedUser = {
  id: 1,
  googleId: 'google-123',
  email: 'test@example.com',
  name: 'Test User',
  picture: 'https://example.com/pic.jpg',
  role: 'user',
};

const mockAdmin: AuthenticatedUser = {
  ...mockUser,
  id: 2,
  role: 'admin',
};

describe('getUser', () => {
  it('returns null when no session', () => {
    const req = createMockRequest();
    const result = getUser(req);

    expect(result).toBeNull();
  });

  it('returns user when properly authenticated', () => {
    const req = createMockRequest(mockUser);
    const result = getUser(req);

    expect(result).toEqual(mockUser);
  });
});

describe('requireAuth', () => {
  it('returns user when authenticated', () => {
    const req = createMockRequest(mockUser);
    const result = requireAuth(req);

    expect(result).toEqual(mockUser);
  });

  it('throws UNAUTHORIZED when not authenticated', () => {
    const req = createMockRequest();

    expect(() => requireAuth(req)).toThrow(TRPCError);

    try {
      requireAuth(req);
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe('UNAUTHORIZED');
    }
  });

});

describe('requireAdmin', () => {
  it('returns user when admin', () => {
    const req = createMockRequest(mockAdmin);
    const result = requireAdmin(req);

    expect(result).toEqual(mockAdmin);
  });

  it('throws FORBIDDEN when user role is not admin', () => {
    const req = createMockRequest(mockUser);

    expect(() => requireAdmin(req)).toThrow(TRPCError);

    try {
      requireAdmin(req);
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe('FORBIDDEN');
    }
  });

  it('throws UNAUTHORIZED when not authenticated', () => {
    const req = createMockRequest();

    expect(() => requireAdmin(req)).toThrow(TRPCError);

    try {
      requireAdmin(req);
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe('UNAUTHORIZED');
    }
  });
});

describe('serializeUser', () => {
  it('correctly maps User to AuthenticatedUser', () => {
    const user: User = {
      id: 1,
      googleId: 'google-456',
      email: 'user@example.com',
      name: 'Example User',
      picture: 'https://example.com/avatar.jpg',
      role: 'user',
      createdAt: new Date('2024-01-01'),
    };

    const result = serializeUser(user);

    expect(result).toEqual({
      id: 1,
      googleId: 'google-456',
      email: 'user@example.com',
      name: 'Example User',
      picture: 'https://example.com/avatar.jpg',
      role: 'user',
    });
  });

  it('preserves admin role', () => {
    const adminUser: User = {
      id: 2,
      googleId: 'google-admin',
      email: 'admin@example.com',
      name: 'Admin User',
      picture: null,
      role: 'admin',
      createdAt: new Date('2024-01-01'),
    };

    const result = serializeUser(adminUser);

    expect(result.role).toBe('admin');
    expect(result.picture).toBeNull();
  });

  it('does not include createdAt in serialized user', () => {
    const user: User = {
      id: 1,
      googleId: 'google-789',
      email: 'test@example.com',
      name: 'Test',
      picture: null,
      role: 'user',
      createdAt: new Date('2024-01-01'),
    };

    const result = serializeUser(user);

    expect(result).not.toHaveProperty('createdAt');
  });
});

describe('getSerializedUserId', () => {
  it('reads numeric session ids', () => {
    expect(getSerializedUserId(42)).toBe(42);
    expect(getSerializedUserId('42')).toBe(42);
  });

  it('reads ids from legacy JSON session payloads without trusting role claims', () => {
    const staleAdminSession = JSON.stringify({
      id: 7,
      googleId: 'google-admin',
      email: 'admin@example.com',
      name: 'Admin',
      picture: null,
      role: 'admin',
    });

    expect(getSerializedUserId(staleAdminSession)).toBe(7);
  });

  it('returns null for malformed session payloads', () => {
    expect(getSerializedUserId('')).toBeNull();
    expect(getSerializedUserId('not-a-number')).toBeNull();
    expect(getSerializedUserId('{bad json')).toBeNull();
    expect(getSerializedUserId(JSON.stringify({ role: 'admin' }))).toBeNull();
  });
});
