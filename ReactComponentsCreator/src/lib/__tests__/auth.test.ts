/**
 * @vitest-environment node
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock server-only module
vi.mock("server-only", () => ({}));

// Mock next/headers
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { createSession, getSession } from "@/lib/auth";
import { cookies } from "next/headers";
import { SignJWT } from "jose";

const mockCookies = vi.mocked(cookies);

describe("createSession", () => {
  const mockSet = vi.fn();
  const mockGet = vi.fn();
  const mockDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockCookies.mockResolvedValue({
      set: mockSet,
      get: mockGet,
      delete: mockDelete,
    } as any);
  });

  test("creates a session with valid userId and email", async () => {
    const userId = "user123";
    const email = "test@example.com";
    const now = new Date("2024-01-01T00:00:00.000Z");
    vi.setSystemTime(now);

    await createSession(userId, email);

    expect(mockCookies).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledTimes(1);

    const [cookieName, token, options] = mockSet.mock.calls[0];

    expect(cookieName).toBe("auth-token");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });

    const expectedExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    expect(options.expires).toEqual(expectedExpiry);
  });

  test("sets secure flag to true in production environment", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    await createSession("user123", "test@example.com");

    const [, , options] = mockSet.mock.calls[0];
    expect(options.secure).toBe(true);

    process.env.NODE_ENV = originalEnv;
  });

  test("sets secure flag to false in development environment", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    await createSession("user123", "test@example.com");

    const [, , options] = mockSet.mock.calls[0];
    expect(options.secure).toBe(false);

    process.env.NODE_ENV = originalEnv;
  });

  test("creates JWT token that expires in 7 days", async () => {
    const now = new Date("2024-01-01T00:00:00.000Z");
    vi.setSystemTime(now);

    await createSession("user123", "test@example.com");

    const [, , options] = mockSet.mock.calls[0];
    const expectedExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    expect(options.expires).toEqual(expectedExpiry);
    expect(options.expires.getTime() - now.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000
    );
  });

  test("creates session with different user IDs", async () => {
    await createSession("user-abc-123", "user1@example.com");
    expect(mockSet).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();

    await createSession("user-xyz-789", "user2@example.com");
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  test("creates session with different email formats", async () => {
    const emails = [
      "simple@example.com",
      "user+tag@example.com",
      "user.name@example.co.uk",
      "user_123@sub.example.com",
    ];

    for (const email of emails) {
      vi.clearAllMocks();
      await createSession("user123", email);

      expect(mockSet).toHaveBeenCalledTimes(1);
      const [cookieName, token] = mockSet.mock.calls[0];
      expect(cookieName).toBe("auth-token");
      expect(typeof token).toBe("string");
    }
  });

  test("JWT token contains userId and email in payload", async () => {
    const jose = await import("jose");
    const userId = "user123";
    const email = "test@example.com";

    await createSession(userId, email);

    const [, token] = mockSet.mock.calls[0];
    const JWT_SECRET = new TextEncoder().encode(
      process.env.JWT_SECRET || "development-secret-key"
    );

    const { payload } = await jose.jwtVerify(token, JWT_SECRET);

    expect(payload.userId).toBe(userId);
    expect(payload.email).toBe(email);
    expect(payload.expiresAt).toBeDefined();
  });

  test("creates valid JWT with HS256 algorithm", async () => {
    const jose = await import("jose");

    await createSession("user123", "test@example.com");

    const [, token] = mockSet.mock.calls[0];
    const JWT_SECRET = new TextEncoder().encode(
      process.env.JWT_SECRET || "development-secret-key"
    );

    const { protectedHeader } = await jose.jwtVerify(token, JWT_SECRET);

    expect(protectedHeader.alg).toBe("HS256");
  });

  test("cookie options include all required security settings", async () => {
    await createSession("user123", "test@example.com");

    const [, , options] = mockSet.mock.calls[0];

    expect(options).toHaveProperty("httpOnly");
    expect(options).toHaveProperty("secure");
    expect(options).toHaveProperty("sameSite");
    expect(options).toHaveProperty("expires");
    expect(options).toHaveProperty("path");

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });
});

describe("getSession", () => {
  const mockGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockCookies.mockResolvedValue({
      get: mockGet,
    } as any);
  });

  test("returns null when no token exists in cookies", async () => {
    mockGet.mockReturnValue(undefined);

    const session = await getSession();

    expect(mockCookies).toHaveBeenCalled();
    expect(mockGet).toHaveBeenCalledWith("auth-token");
    expect(session).toBeNull();
  });

  test("returns valid session payload when token is valid", async () => {
    const userId = "user123";
    const email = "test@example.com";
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const JWT_SECRET = new TextEncoder().encode(
      process.env.JWT_SECRET || "development-secret-key"
    );

    const token = await new SignJWT({ userId, email, expiresAt })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("7d")
      .setIssuedAt()
      .sign(JWT_SECRET);

    mockGet.mockReturnValue({ value: token });

    const session = await getSession();

    expect(session).toBeDefined();
    expect(session?.userId).toBe(userId);
    expect(session?.email).toBe(email);
    expect(session?.expiresAt).toBeDefined();
  });

  test("returns null when token verification fails with invalid token", async () => {
    mockGet.mockReturnValue({ value: "invalid-token-string" });

    const session = await getSession();

    expect(mockCookies).toHaveBeenCalled();
    expect(session).toBeNull();
  });

  test("returns null when token is expired", async () => {
    const userId = "user123";
    const email = "test@example.com";
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const JWT_SECRET = new TextEncoder().encode(
      process.env.JWT_SECRET || "development-secret-key"
    );

    const expiredToken = await new SignJWT({ userId, email, expiresAt })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .setIssuedAt()
      .sign(JWT_SECRET);

    mockGet.mockReturnValue({ value: expiredToken });

    const session = await getSession();

    expect(session).toBeNull();
  });

  test("correctly extracts all session payload fields", async () => {
    const userId = "user-abc-123";
    const email = "user@example.com";
    const expiresAt = new Date("2025-12-31T23:59:59.999Z");

    const JWT_SECRET = new TextEncoder().encode(
      process.env.JWT_SECRET || "development-secret-key"
    );

    const token = await new SignJWT({ userId, email, expiresAt })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("7d")
      .setIssuedAt()
      .sign(JWT_SECRET);

    mockGet.mockReturnValue({ value: token });

    const session = await getSession();

    expect(session).toBeDefined();
    expect(session).toHaveProperty("userId");
    expect(session).toHaveProperty("email");
    expect(session).toHaveProperty("expiresAt");
    expect(session?.userId).toBe(userId);
    expect(session?.email).toBe(email);
  });

  test("returns null when token is signed with wrong secret", async () => {
    const wrongSecret = new TextEncoder().encode("wrong-secret-key");

    const token = await new SignJWT({
      userId: "user123",
      email: "test@example.com",
      expiresAt: new Date(),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("7d")
      .setIssuedAt()
      .sign(wrongSecret);

    mockGet.mockReturnValue({ value: token });

    const session = await getSession();

    expect(session).toBeNull();
  });

  test("handles multiple calls to getSession", async () => {
    const userId = "user123";
    const email = "test@example.com";
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const JWT_SECRET = new TextEncoder().encode(
      process.env.JWT_SECRET || "development-secret-key"
    );

    const token = await new SignJWT({ userId, email, expiresAt })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("7d")
      .setIssuedAt()
      .sign(JWT_SECRET);

    mockGet.mockReturnValue({ value: token });

    const session1 = await getSession();
    const session2 = await getSession();

    expect(session1).toBeDefined();
    expect(session2).toBeDefined();
    expect(session1?.userId).toBe(session2?.userId);
    expect(session1?.email).toBe(session2?.email);
  });

  test("returns null when cookie value is empty string", async () => {
    mockGet.mockReturnValue({ value: "" });

    const session = await getSession();

    expect(session).toBeNull();
  });

  test("handles different email formats in session", async () => {
    const emails = [
      "simple@example.com",
      "user+tag@example.com",
      "user.name@example.co.uk",
      "user_123@sub.example.com",
    ];

    const JWT_SECRET = new TextEncoder().encode(
      process.env.JWT_SECRET || "development-secret-key"
    );

    for (const email of emails) {
      const token = await new SignJWT({
        userId: "user123",
        email,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("7d")
        .setIssuedAt()
        .sign(JWT_SECRET);

      mockGet.mockReturnValue({ value: token });

      const session = await getSession();

      expect(session).toBeDefined();
      expect(session?.email).toBe(email);
    }
  });
});
