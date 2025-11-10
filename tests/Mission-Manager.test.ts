import { describe, it, expect, beforeEach } from "vitest";
import {
  buffCV,
  uintCV,
  stringAsciiCV,
  some,
  none,
} from "@stacks/transactions";

const ERR_UNAUTHORIZED = 100;
const ERR_MISSION_NOT_FOUND = 101;
const ERR_INVALID_STATUS = 102;
const ERR_ALREADY_EXISTS = 103;
const ERR_INVALID_BUDGET = 104;
const ERR_INVALID_DATE = 105;
const ERR_INVALID_OBSERVER_COUNT = 113;
const ERR_STATUS_TRANSITION = 114;
const ERR_REPORT_MISSING = 112;

interface Mission {
  country: string;
  electionDate: bigint;
  budget: bigint;
  status: string;
  proposer: string;
  observerSlots: bigint;
  totalExpenses: bigint;
  reportHash: string | null;
  createdAt: bigint;
  fundedAt: bigint | null;
  completedAt: bigint | null;
}

interface VoteTally {
  yes: bigint;
  no: bigint;
}

class MissionManagerMock {
  state: {
    lastMissionId: bigint;
    daoTreasury: string;
    minQuorumPercent: bigint;
    proposalDuration: bigint;
    missions: Map<bigint, Mission>;
    missionVotes: Map<bigint, VoteTally>;
    voterRecords: Map<string, boolean>;
    nftOwners: Map<bigint, string>;
  } = {
    lastMissionId: 0n,
    daoTreasury: "ST1TREASURY",
    minQuorumPercent: 51n,
    proposalDuration: 1440n,
    missions: new Map(),
    missionVotes: new Map(),
    voterRecords: new Map(),
    nftOwners: new Map(),
  };

  blockHeight = 1000n;
  caller = "ST1PROPOSER";

  reset() {
    this.state = {
      lastMissionId: 0n,
      daoTreasury: "ST1TREASURY",
      minQuorumPercent: 51n,
      proposalDuration: 1440n,
      missions: new Map(),
      missionVotes: new Map(),
      voterRecords: new Map(),
      nftOwners: new Map(),
    };
    this.blockHeight = 1000n;
    this.caller = "ST1PROPOSER";
  }

  proposeMission(
    country: string,
    electionDate: bigint,
    budget: bigint,
    observerSlots: bigint
  ): { ok: boolean; value: bigint | number } {
    if (budget <= 0n) return { ok: false, value: ERR_INVALID_BUDGET };
    if (electionDate <= this.blockHeight)
      return { ok: false, value: ERR_INVALID_DATE };
    if (observerSlots < 2n)
      return { ok: false, value: ERR_INVALID_OBSERVER_COUNT };
    const id = this.state.lastMissionId + 1n;
    if (this.state.missions.has(id))
      return { ok: false, value: ERR_ALREADY_EXISTS };

    this.state.nftOwners.set(id, this.caller);
    this.state.missions.set(id, {
      country,
      electionDate,
      budget,
      status: "proposed",
      proposer: this.caller,
      observerSlots,
      totalExpenses: 0n,
      reportHash: null,
      createdAt: this.blockHeight,
      fundedAt: null,
      completedAt: null,
    });
    this.state.missionVotes.set(id, { yes: 0n, no: 0n });
    this.state.lastMissionId = id;
    return { ok: true, value: id };
  }

  voteOnMission(
    missionId: bigint,
    support: boolean
  ): { ok: boolean; value: boolean | number } {
    const mission = this.state.missions.get(missionId);
    if (!mission) return { ok: false, value: ERR_MISSION_NOT_FOUND };
    if (mission.status !== "proposed")
      return { ok: false, value: ERR_INVALID_STATUS };
    const key = `${missionId}-${this.caller}`;
    if (this.state.voterRecords.get(key))
      return { ok: false, value: ERR_UNAUTHORIZED };

    this.state.voterRecords.set(key, true);
    const votes = this.state.missionVotes.get(missionId)!;
    const newVotes = support
      ? { yes: votes.yes + 1n, no: votes.no }
      : { yes: votes.yes, no: votes.no + 1n };
    this.state.missionVotes.set(missionId, newVotes);

    const total = newVotes.yes + newVotes.no;
    const quorumNeeded = (total * this695.state.minQuorumPercent) / 100n;
    if (newVotes.yes >= quorumNeeded && newVotes.yes > total / 2n) {
      mission.status = "funded";
      mission.fundedAt = this.blockHeight;
    }
    return { ok: true, value: true };
  }

  activateMission(missionId: bigint): { ok: boolean; value: boolean | number } {
    const mission = this.state.missions.get(missionId);
    if (!mission) return { ok: false, value: ERR_MISSION_NOT_FOUND };
    if (mission.status !== "funded")
      return { ok: false, value: ERR_STATUS_TRANSITION };
    if (this.blockHeight < mission.electionDate)
      return { ok: false, value: ERR_INVALID_DATE };
    mission.status = "active";
    return { ok: true, value: true };
  }

  submitReport(
    missionId: bigint,
    reportHash: Uint8Array
  ): { ok: boolean; value: boolean | number } {
    const mission = this.state.missions.get(missionId);
    if (!mission) return { ok: false, value: ERR_MISSION_NOT_FOUND };
    if (mission.status !== "active")
      return { ok: false, value: ERR_INVALID_STATUS };
    if (mission.proposer !== this.caller)
      return { ok: false, value: ERR_UNAUTHORIZED };
    mission.status = "completed";
    mission.reportHash = Buffer.from(reportHash).toString("hex");
    mission.completedAt = this.blockHeight;
    return { ok: true, value: true };
  }

  auditMission(
    missionId: bigint,
    approved: boolean
  ): { ok: boolean; value: boolean | number } {
    const mission = this.state.missions.get(missionId);
    if (!mission) return { ok: false, value: ERR_MISSION_NOT_FOUND };
    if (mission.status !== "completed")
      return { ok: false, value: ERR_STATUS_TRANSITION };
    if (!mission.reportHash) return { ok: false, value: ERR_REPORT_MISSING };
    mission.status = approved ? "audited" : "rejected";
    return { ok: true, value: true };
  }

  getMission(id: bigint): Mission | null {
    return this.state.missions.get(id) || null;
  }

  getVoteTally(id: bigint): VoteTally {
    return this.state.missionVotes.get(id) || { yes: 0n, no: 0n };
  }

  hasVoted(missionId: bigint, voter: string): boolean {
    return this.state.voterRecords.get(`${missionId}-${voter}`) || false;
  }
}

describe("MissionManager Core Contract", () => {
  let contract: MissionManagerMock;

  beforeEach(() => {
    contract = new MissionManagerMock();
    contract.reset();
  });

  it("proposes a new mission successfully", () => {
    const result = contract.proposeMission("Kenya", 1500n, 5000000n, 5n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1n);
    const mission = contract.getMission(1n);
    expect(mission?.country).toBe("Kenya");
    expect(mission?.budget).toBe(5000000n);
    expect(mission?.status).toBe("proposed");
    expect(mission?.proposer).toBe("ST1PROPOSER");
  });

  it("rejects mission with zero budget", () => {
    const result = contract.proposeMission("Uganda", 1600n, 0n, 3n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_BUDGET);
  });

  it("rejects mission in the past", () => {
    const result = contract.proposeMission("Ghana", 900n, 3000000n, 4n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DATE);
  });

  it("rejects mission with less than 2 observers", () => {
    const result = contract.proposeMission("Nigeria", 2000n, 4000000n, 1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_OBSERVER_COUNT);
  });

  it("rejects activation before election date", () => {
    contract.proposeMission("Germany", 2000n, 7000000n, 4n);
    const mission = contract.getMission(1n);
    mission!.status = "funded";
    const result = contract.activateMission(1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DATE);
  });

  it("allows proposer to submit report", () => {
    contract.proposeMission("Mexico", 1800n, 9000000n, 7n);
    const mission = contract.getMission(1n)!;
    mission.status = "active";
    const hash = new Uint8Array(32).fill(1);
    const result = contract.submitReport(1n, hash);
    expect(result.ok).toBe(true);
    expect(mission.status).toBe("completed");
    expect(mission.reportHash).toBeTruthy();
  });

  it("rejects report from non-proposer", () => {
    contract.proposeMission("Peru", 1900n, 4000000n, 3n);
    const mission = contract.getMission(1n)!;
    mission.status = "active";
    contract.caller = "ST4FAKE";
    const result = contract.submitReport(1n, new Uint8Array(32));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("audits completed mission with valid report", () => {
    contract.proposeMission("Chile", 2100n, 5500000n, 5n);
    const mission = contract.getMission(1n)!;
    mission.status = "completed";
    mission.reportHash = "abc123";
    const result = contract.auditMission(1n, true);
    expect(result.ok).toBe(true);
    expect(mission.status).toBe("audited");
  });

  it("rejects audit without report", () => {
    contract.proposeMission("Bolivia", 2200n, 3000000n, 4n);
    const mission = contract.getMission(1n)!;
    mission.status = "completed";
    mission.reportHash = null;
    const result = contract.auditMission(1n, true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_REPORT_MISSING);
  });

  it("returns correct mission data via read-only", () => {
    contract.proposeMission("Venezuela", 2500n, 6500000n, 5n);
    const mission = contract.getMission(1n);
    expect(mission?.country).toBe("Venezuela");
    expect(mission?.observerSlots).toBe(5n);
    expect(mission?.totalExpenses).toBe(0n);
  });
});
