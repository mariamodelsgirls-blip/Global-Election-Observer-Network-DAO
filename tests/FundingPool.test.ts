// FundingPool.test.ts

import { describe, it, expect, beforeEach } from "vitest";

const ERR_UNAUTHORIZED = 100;
const ERR_INSUFFICIENT_BALANCE = 102;
const ERR_MIN_CONTRIBUTION = 104;
const ERR_POOL_CLOSED = 108;
const ERR_EMERGENCY_MODE = 109;
const ERR_INVALID_AMOUNT = 107;

interface Contribution {
  missionId: bigint;
  contributor: string;
  amount: bigint;
}

class FundingPoolMock {
  state: {
    poolActive: boolean;
    emergencyMode: boolean;
    minContribution: bigint;
    treasury: string;
    totalCollected: bigint;
    totalDistributed: bigint;
    contributions: Map<string, bigint>;
    missionBalances: Map<bigint, bigint>;
    withdrawnRecords: Map<string, boolean>;
    stxTransfers: Array<{ from: string; to: string; amount: bigint }>;
  } = {
    poolActive: true,
    emergencyMode: false,
    minContribution: 1000000n,
    treasury: "ST1TREASURY",
    totalCollected: 0n,
    totalDistributed: 0n,
    contributions: new Map(),
    missionBalances: new Map(),
    withdrawnRecords: new Map(),
    stxTransfers: [],
  };

  caller = "ST1CONTRIBUTOR";
  contractPrincipal = "ST1FUNDINGPOOL";

  reset() {
    this.state = {
      poolActive: true,
      emergencyMode: false,
      minContribution: 1000000n,
      treasury: "ST1TREASURY",
      totalCollected: 0n,
      totalDistributed: 0n,
      contributions: new Map(),
      missionBalances: new Map(),
      withdrawnRecords: new Map(),
      stxTransfers: [],
    };
    this.caller = "ST1CONTRIBUTOR";
  }

  contribute(
    missionId: bigint,
    amount: bigint
  ): { ok: boolean; value: boolean | number } {
    if (!this.state.poolActive) return { ok: false, value: ERR_POOL_CLOSED };
    if (this.state.emergencyMode)
      return { ok: false, value: ERR_EMERGENCY_MODE };
    if (amount < this.state.minContribution)
      return { ok: false, value: ERR_MIN_CONTRIBUTION };
    if (amount <= 0n) return { ok: false, value: ERR_INVALID_AMOUNT };

    const key = `${missionId}-${this.caller}`;
    const existing = this.state.contributions.get(key) || 0n;
    this.state.contributions.set(key, existing + amount);
    this.state.missionBalances.set(
      missionId,
      (this.state.missionBalances.get(missionId) || 0n) + amount
    );
    this.state.totalCollected += amount;
    this.state.stxTransfers.push({
      from: this.caller,
      to: this.contractPrincipal,
      amount,
    });
    return { ok: true, value: true };
  }

  withdrawContribution(missionId: bigint): {
    ok: boolean;
    value: bigint | number;
  } {
    const key = `${missionId}-${this.caller}`;
    const amount = this.state.contributions.get(key) || 0n;
    if (amount <= 0n) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    if (this.state.withdrawnRecords.get(key)) return { ok: false, value: 103 };
    if (!this.state.poolActive) return { ok: false, value: ERR_POOL_CLOSED };

    this.state.withdrawnRecords.set(key, true);
    this.state.contributions.set(key, 0n);
    this.state.missionBalances.set(
      missionId,
      (this.state.missionBalances.get(missionId) || 0n) - amount
    );
    this.state.totalCollected -= amount;
    this.state.stxTransfers.push({
      from: this.contractPrincipal,
      to: this.caller,
      amount,
    });
    return { ok: true, value: amount };
  }

  distributeToMission(
    missionId: bigint,
    amount: bigint,
    proposer: string
  ): { ok: boolean; value: boolean | number } {
    if (this.caller !== this.state.treasury)
      return { ok: false, value: ERR_UNAUTHORIZED };
    const balance = this.state.missionBalances.get(missionId) || 0n;
    if (balance < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    if (!this.state.poolActive) return { ok: false, value: ERR_POOL_CLOSED };

    this.state.missionBalances.set(missionId, balance - amount);
    this.state.totalDistributed += amount;
    this.state.stxTransfers.push({
      from: this.contractPrincipal,
      to: proposer,
      amount,
    });
    return { ok: true, value: true };
  }

  emergencyWithdrawAll(to: string): { ok: boolean; value: bigint | number } {
    if (this.caller !== this.state.treasury)
      return { ok: false, value: ERR_UNAUTHORIZED };
    this.state.emergencyMode = true;
    this.state.poolActive = false;
    const balance = this.state.totalCollected - this.state.totalDistributed;
    this.state.stxTransfers.push({
      from: this.contractPrincipal,
      to,
      amount: balance,
    });
    return { ok: true, value: balance };
  }

  getPoolStatus() {
    return {
      active: this.state.poolActive,
      emergency: this.state.emergencyMode,
      totalCollected: this.state.totalCollected,
      totalDistributed: this.state.totalDistributed,
      minContribution: this.state.minContribution,
      treasury: this.state.treasury,
    };
  }

  getContribution(missionId: bigint, contributor: string): bigint {
    return this.state.contributions.get(`${missionId}-${contributor}`) || 0n;
  }

  getMissionBalance(missionId: bigint): bigint {
    return this.state.missionBalances.get(missionId) || 0n;
  }
}

describe("FundingPool Contract", () => {
  let pool: FundingPoolMock;

  beforeEach(() => {
    pool = new FundingPoolMock();
    pool.reset();
  });

  it("allows valid contribution", () => {
    const result = pool.contribute(1n, 5000000n);
    expect(result.ok).toBe(true);
    expect(pool.getContribution(1n, "ST1CONTRIBUTOR")).toBe(5000000n);
    expect(pool.getMissionBalance(1n)).toBe(5000000n);
    expect(pool.state.totalCollected).toBe(5000000n);
  });

  it("enforces minimum contribution", () => {
    const result = pool.contribute(1n, 500000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MIN_CONTRIBUTION);
  });

  it("allows multiple contributions to same mission", () => {
    pool.contribute(1n, 3000000n);
    pool.caller = "ST2DONOR";
    pool.contribute(1n, 7000000n);
    expect(pool.getMissionBalance(1n)).toBe(10000000n);
    expect(pool.state.totalCollected).toBe(10000000n);
  });

  it("allows withdrawal before distribution", () => {
    pool.contribute(1n, 4000000n);
    const result = pool.withdrawContribution(1n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(4000000n);
    expect(pool.getContribution(1n, "ST1CONTRIBUTOR")).toBe(0n);
    expect(pool.state.totalCollected).toBe(0n);
  });

  it("prevents double withdrawal", () => {
    pool.contribute(1n, 2000000n);
    pool.withdrawContribution(1n);
    const result = pool.withdrawContribution(1n);
    expect(result.ok).toBe(false);
  });

  it("blocks contribution when pool is closed", () => {
    pool.caller = "ST1TREASURY";
    pool.state.poolActive = false;
    pool.caller = "ST1CONTRIBUTOR";
    const result = pool.contribute(1n, 3000000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_POOL_CLOSED);
  });

  it("blocks operations in emergency mode", () => {
    pool.state.emergencyMode = true;
    const result = pool.contribute(1n, 5000000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_EMERGENCY_MODE);
  });

  it("treasury can distribute funds", () => {
    pool.contribute(1n, 10000000n);
    pool.caller = "ST1TREASURY";
    const result = pool.distributeToMission(1n, 8000000n, "ST1PROPOSER");
    expect(result.ok).toBe(true);
    expect(pool.getMissionBalance(1n)).toBe(2000000n);
    expect(pool.state.totalDistributed).toBe(8000000n);
  });

  it("non-treasury cannot distribute", () => {
    pool.contribute(1n, 5000000n);
    const result = pool.distributeToMission(1n, 3000000n, "ST1PROPOSER");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("emergency withdraw drains entire pool", () => {
    pool.contribute(1n, 10000000n);
    pool.caller = "ST2DONOR";
    pool.contribute(2n, 15000000n);
    pool.caller = "ST1TREASURY";
    const result = pool.emergencyWithdrawAll("ST1SAFE");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(25000000n);
    expect(pool.state.emergencyMode).toBe(true);
    expect(pool.state.poolActive).toBe(false);
  });

  it("updates min contribution by treasury", () => {
    pool.caller = "ST1TREASURY";
    pool.state.minContribution = 5000000n;
    pool.caller = "ST1CONTRIBUTOR";
    const result = pool.contribute(1n, 4000000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MIN_CONTRIBUTION);
  });

  it("tracks total collected and distributed accurately", () => {
    pool.contribute(1n, 10000000n);
    pool.caller = "ST2DONOR";
    pool.contribute(1n, 5000000n);
    pool.caller = "ST1TREASURY";
    pool.distributeToMission(1n, 12000000n, "ST1PROPOSER");
    const status = pool.getPoolStatus();
    expect(status.totalCollected).toBe(15000000n);
    expect(status.totalDistributed).toBe(12000000n);
  });

  it("prevents distribution exceeding mission balance", () => {
    pool.contribute(1n, 5000000n);
    pool.caller = "ST1TREASURY";
    const result = pool.distributeToMission(1n, 10000000n, "ST1PROPOSER");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_BALANCE);
  });

  it("records all STX transfers correctly", () => {
    pool.contribute(1n, 3000000n);
    pool.withdrawContribution(1n);
    pool.caller = "ST1TREASURY";
    pool.contribute(1n, 7000000n);
    expect(pool.state.stxTransfers.length).toBe(3);
  });

  it("returns correct pool status", () => {
    pool.contribute(1n, 8000000n);
    const status = pool.getPoolStatus();
    expect(status.active).toBe(true);
    expect(status.totalCollected).toBe(8000000n);
    expect(status.minContribution).toBe(1000000n);
    expect(status.treasury).toBe("ST1TREASURY");
  });
});
