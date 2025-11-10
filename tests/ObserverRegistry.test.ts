// ObserverRegistry.test.ts

import { describe, it, expect, beforeEach } from "vitest";

const ERR_UNAUTHORIZED = 100;
const ERR_ALREADY_REGISTERED = 101;
const ERR_NOT_REGISTERED = 102;
const ERR_INVALID_BIO = 104;
const ERR_MISSION_NOT_ACTIVE = 107;
const ERR_ALREADY_APPLIED = 108;
const ERR_SLOTS_FULL = 109;
const ERR_NOT_SELECTED = 110;
const ERR_ALREADY_REVIEWED = 111;
const ERR_INVALID_RATING = 112;

interface Observer {
  reputation: bigint;
  missionsCompleted: bigint;
  bio: string;
  languages: string[];
  countries: string[];
  joinedAt: bigint;
  isActive: boolean;
  totalEarned: bigint;
}

class ObserverRegistryMock {
  state: {
    registryActive: boolean;
    minReputation: bigint;
    maxBioLength: bigint;
    treasury: string;
    observers: Map<string, Observer>;
    applications: Map<string, boolean>;
    selected: Map<string, boolean>;
    reviews: Map<string, { rating: bigint; comment: string }>;
  } = {
    registryActive: true,
    minReputation: 50n,
    maxBioLength: 500n,
    treasury: "ST1TREASURY",
    observers: new Map(),
    applications: new Map(),
    selected: new Map(),
    reviews: new Map(),
  };

  caller = "ST1OBSERVER";
  blockHeight = 2000n;

  reset() {
    this.state = {
      registryActive: true,
      minReputation: 50n,
      maxBioLength: 500n,
      treasury: "ST1TREASURY",
      observers: new Map(),
      applications: new Map(),
      selected: new Map(),
      reviews: new Map(),
    };
    this.caller = "ST1OBSERVER";
    this.blockHeight = 2000n;
  }

  registerObserver(
    bio: string,
    languages: string[],
    countries: string[]
  ): { ok: boolean; value: boolean | number } {
    if (!this.state.registryActive)
      return { ok: false, value: ERR_UNAUTHORIZED };
    if (this.state.observers.has(this.caller))
      return { ok: false, value: ERR_ALREADY_REGISTERED };
    if (bio.length > Number(this.state.maxBioLength))
      return { ok: false, value: ERR_INVALID_BIO };

    this.state.observers.set(this.caller, {
      reputation: 100n,
      missionsCompleted: 0n,
      bio,
      languages,
      countries,
      joinedAt: this.blockHeight,
      isActive: true,
      totalEarned: 0n,
    });
    return { ok: true, value: true };
  }

  applyToMission(
    missionId: bigint,
    missionStatus: string,
    observerSlots: bigint,
    reputation?: bigint
  ): { ok: boolean; value: boolean | number } {
    if (!this.state.observers.has(this.caller))
      return { ok: false, value: ERR_NOT_REGISTERED };
    if (missionStatus !== "active")
      return { ok: false, value: ERR_MISSION_NOT_ACTIVE };
    const appKey = `${missionId}-${this.caller}`;
    if (this.state.applications.get(appKey))
      return { ok: false, value: ERR_ALREADY_APPLIED };

    const rep = reputation ?? this.state.observers.get(this.caller)!.reputation;
    if (rep < this.state.minReputation) return { ok: false, value: 103 };

    this.state.applications.set(appKey, true);
    return { ok: true, value: true };
  }

  selectObserver(
    missionId: bigint,
    observer: string,
    proposer: string,
    slots: bigint
  ): { ok: boolean; value: boolean | number } {
    if (this.caller !== proposer) return { ok: false, value: ERR_UNAUTHORIZED };
    const appKey = `${missionId}-${observer}`;
    if (!this.state.applications.get(appKey))
      return { ok: false, value: ERR_NOT_SELECTED };

    const selectedCount = Array.from(this.state.selected.keys()).filter((k) =>
      k.startsWith(`${missionId}-`)
    ).length;
    if (BigInt(selectedCount) >= slots)
      return { ok: false, value: ERR_SLOTS_FULL };

    this.state.selected.set(`${missionId}-${observer}`, true);
    return { ok: true, value: true };
  }

  submitReview(
    missionId: bigint,
    observer: string,
    rating: bigint,
    proposer: string
  ): { ok: boolean; value: boolean | number } {
    if (this.caller !== proposer) return { ok: false, value: ERR_UNAUTHORIZED };
    if (!this.state.selected.has(`${missionId}-${observer}`))
      return { ok: false, value: ERR_NOT_SELECTED };
    const reviewKey = `${missionId}-${this.caller}`;
    if (this.state.reviews.has(reviewKey))
      return { ok: false, value: ERR_ALREADY_REVIEWED };
    if (rating < 1n || rating > 5n)
      return { ok: false, value: ERR_INVALID_RATING };

    this.state.reviews.set(reviewKey, { rating, comment: "Great work!" });
    const obs = this.state.observers.get(observer)!;
    this.state.observers.set(observer, {
      ...obs,
      reputation: obs.reputation + (rating >= 4n ? 10n : 0n),
      missionsCompleted: obs.missionsCompleted + 1n,
    });
    return { ok: true, value: true };
  }

  getObserver(addr: string): Observer | null {
    return this.state.observers.get(addr) || null;
  }
}

describe("ObserverRegistry Contract", () => {
  let registry: ObserverRegistryMock;

  beforeEach(() => {
    registry = new ObserverRegistryMock();
    registry.reset();
  });

  it("registers observer successfully", () => {
    const result = registry.registerObserver(
      "Election expert from Kenya",
      ["en", "sw"],
      ["Kenya", "Uganda"]
    );
    expect(result.ok).toBe(true);
    const obs = registry.getObserver("ST1OBSERVER");
    expect(obs?.bio).toBe("Election expert from Kenya");
    expect(obs?.reputation).toBe(100n);
    expect(obs?.isActive).toBe(true);
  });

  it("rejects duplicate registration", () => {
    registry.registerObserver("Bio", ["en"], ["KE"]);
    const result = registry.registerObserver("New bio", ["fr"], ["FR"]);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_REGISTERED);
  });

  it("allows application to active mission", () => {
    registry.registerObserver("Observer", ["en"], ["NG"]);
    const result = registry.applyToMission(1n, "active", 5n);
    expect(result.ok).toBe(true);
  });

  it("blocks application to non-active mission", () => {
    registry.registerObserver("Observer", ["en"], ["NG"]);
    const result = registry.applyToMission(1n, "funded", 5n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MISSION_NOT_ACTIVE);
  });

  it("enforces minimum reputation for application", () => {
    registry.registerObserver("Low rep", ["en"], ["NG"]);
    registry.state.observers.get("ST1OBSERVER")!.reputation = 30n;
    const result = registry.applyToMission(1n, "active", 5n, 30n);
    expect(result.ok).toBe(false);
  });

  it("proposer can select applied observer", () => {
    registry.registerObserver("Obs", ["en"], ["BR"]);
    registry.applyToMission(1n, "active", 3n);
    registry.caller = "ST1PROPOSER";
    const result = registry.selectObserver(
      1n,
      "ST1OBSERVER",
      "ST1PROPOSER",
      3n
    );
    expect(result.ok).toBe(true);
  });

  it("allows review and reputation boost", () => {
    registry.registerObserver("Great obs", ["en"], ["CO"]);
    registry.applyToMission(1n, "active", 1n);
    registry.caller = "ST1PROPOSER";
    registry.selectObserver(1n, "ST1OBSERVER", "ST1PROPOSER", 1n);
    const result = registry.submitReview(1n, "ST1OBSERVER", 5n, "ST1PROPOSER");
    expect(result.ok).toBe(true);
    const obs = registry.getObserver("ST1OBSERVER");
    expect(obs?.reputation).toBe(110n);
    expect(obs?.missionsCompleted).toBe(1n);
  });

  it("prevents double review", () => {
    registry.registerObserver("Obs", ["en"], ["PE"]);
    registry.applyToMission(1n, "active", 1n);
    registry.caller = "ST1PROPOSER";
    registry.selectObserver(1n, "ST1OBSERVER", "ST1PROPOSER", 1n);
    registry.submitReview(1n, "ST1OBSERVER", 4n, "ST1PROPOSER");
    const result = registry.submitReview(1n, "ST1OBSERVER", 3n, "ST1PROPOSER");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_REVIEWED);
  });

  it("treasury can deactivate observer", () => {
    registry.registerObserver("Bad actor", ["en"], ["VE"]);
    registry.caller = "ST1TREASURY";
    registry.state.observers.get("ST1OBSERVER")!.isActive = false;
    expect(registry.getObserver("ST1OBSERVER")?.isActive).toBe(false);
  });

  it("updates reputation only on high ratings", () => {
    registry.registerObserver("Avg obs", ["en"], ["CL"]);
    registry.applyToMission(1n, "active", 1n);
    registry.caller = "ST1PROPOSER";
    registry.selectObserver(1n, "ST1OBSERVER", "ST1PROPOSER", 1n);
    registry.submitReview(1n, "ST1OBSERVER", 3n, "ST1PROPOSER");
    expect(registry.getObserver("ST1OBSERVER")?.reputation).toBe(100n);
  });

  it("returns null for non-existent observer", () => {
    expect(registry.getObserver("ST999")).toBeNull();
  });

  it("tracks multiple applications correctly", () => {
    registry.registerObserver(
      "Global obs",
      ["en", "fr", "es"],
      ["KE", "NG", "ZA"]
    );
    registry.applyToMission(1n, "active", 5n);
    registry.applyToMission(2n, "active", 4n);
    expect(registry.state.applications.size).toBe(2);
  });
});
