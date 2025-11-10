(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-MISSION-NOT-FOUND u101)
(define-constant ERR-INVALID-STATUS u102)
(define-constant ERR-ALREADY-EXISTS u103)
(define-constant ERR-INVALID-BUDGET u104)
(define-constant ERR-INVALID-DATE u105)
(define-constant ERR-INVALID-LOCATION u106)
(define-constant ERR-INVALID-QUORUM u107)
(define-constant ERR-INSUFFICIENT-FUNDS u108)
(define-constant ERR-PROPOSAL-EXPIRED u109)
(define-constant ERR-ALREADY-FUNDED u110)
(define-constant ERR-AUDIT-FAILED u111)
(define-constant ERR-REPORT-MISSING u112)
(define-constant ERR-INVALID-OBSERVER-COUNT u113)
(define-constant ERR-STATUS-TRANSITION u114)

(define-non-fungible-token mission uint)

(define-data-var last-mission-id uint u0)
(define-data-var dao-treasury principal tx-sender)
(define-data-var min-quorum-percent uint u51)
(define-data-var proposal-duration uint u1440)

(define-map missions
  uint
  {
    country: (string-ascii 80),
    election-date: uint,
    budget: uint,
    status: (string-ascii 20),
    proposer: principal,
    observer-slots: uint,
    total-expenses: uint,
    report-hash: (optional (buff 32)),
    created-at: uint,
    funded-at: (optional uint),
    completed-at: (optional uint)
  }
)

(define-map mission-votes uint { yes: uint, no: uint })
(define-map voter-records { mission-id: uint, voter: principal } bool)

(define-read-only (get-mission (id uint))
  (map-get? missions id)
)

(define-read-only (get-vote-tally (id uint))
  (default-to { yes: u0, no: u0 } (map-get? mission-votes id))
)

(define-read-only (has-voted (mission-id uint) (voter principal))
  (default-to false (map-get? voter-records { mission-id: mission-id, voter: voter }))
)

(define-read-only (get-current-status (id uint))
  (match (map-get? missions id)
    mission (ok (get status mission))
    (err ERR-MISSION-NOT-FOUND))
)

(define-private (valid-status-transition (current (string-ascii 20)) (next (string-ascii 20)))
  (or
    (and (is-eq current "proposed") (is-eq next "funded"))
    (and (is-eq current "funded") (is-eq next "active"))
    (and (is-eq current "active") (is-eq next "completed"))
    (and (is-eq current "completed") (is-eq next "audited"))
    false
  )
)

(define-public (propose-mission
  (country (string-ascii 80))
  (election-date uint)
  (budget uint)
  (observer-slots uint)
)
  (let ((mission-id (+ (var-get last-mission-id) u1)))
    (asserts! (> budget u0) (err ERR-INVALID-BUDGET))
    (asserts! (> election-date block-height) (err ERR-INVALID-DATE))
    (asserts! (>= observer-slots u2) (err ERR-INVALID-OBSERVER-COUNT))
    (asserts! (is-none (map-get? missions mission-id)) (err ERR-ALREADY-EXISTS))
    (try! (nft-mint? mission mission-id tx-sender))
    (map-set missions mission-id
      {
        country: country,
        election-date: election-date,
        budget: budget,
        status: "proposed",
        proposer: tx-sender,
        observer-slots: observer-slots,
        total-expenses: u0,
        report-hash: none,
        created-at: block-height,
        funded-at: none,
        completed-at: none
      }
    )
    (map-set mission-votes mission-id { yes: u0, no: u0 })
    (var-set last-mission-id mission-id)
    (print { event: "mission-proposed", id: mission-id })
    (ok mission-id)
  )
)

(define-public (vote-on-mission (mission-id uint) (support bool))
  (let ((mission (unwrap! (map-get? missions mission-id) (err ERR-MISSION-NOT-FOUND)))
        (votes (default-to { yes: u0, no: u0 } (map-get? mission-votes mission-id))))
    (asserts! (is-eq (get status mission) "proposed") (err ERR-INVALID-STATUS))
    (asserts! (not (has-voted mission-id tx-sender)) (err ERR-UNAUTHORIZED))
    (map-set voter-records { mission-id: mission-id, voter: tx-sender } true)
    (map-set mission-votes mission-id
      (if support
        { yes: (+ (get yes votes) u1), no: (get no votes) }
        { yes: (get yes votes), no: (+ (get no votes) u1) }
      )
    )
    (let ((yes-votes (+ (get yes votes) (if support u1 u0)))
          (total-votes (+ (get yes votes) (get no votes) u1))
          (quorum-required (/ (* total-votes (var-get min-quorum-percent)) u100)))
      (if (and (>= yes-votes quorum-required) (>= yes-votes (/ total-votes u2)))
        (begin
          (map-set missions mission-id (merge mission { status: "funded", funded-at: (some block-height) }))
          (print { event: "mission-funded", id: mission-id })
        )
        (ok true)
      )
    )
    (ok true)
  )
)

(define-public (activate-mission (mission-id uint))
  (let ((mission (unwrap! (map-get? missions mission-id) (err ERR-MISSION-NOT-FOUND))))
    (asserts! (is-eq (get status mission) "funded") (err ERR-STATUS-TRANSITION))
    (asserts! (>= block-height (get election-date mission)) (err ERR-INVALID-DATE))
    (map-set missions mission-id (merge mission { status: "active" }))
    (print { event: "mission-activated", id: mission-id })
    (ok true)
  )
)

(define-public (submit-report (mission-id uint) (report-hash (buff 32)))
  (let ((mission (unwrap! (map-get? missions mission-id) (err ERR-MISSION-NOT-FOUND))))
    (asserts! (is-eq (get status mission) "active") (err ERR-INVALID-STATUS))
    (asserts! (is-eq (get proposer mission) tx-sender) (err ERR-UNAUTHORIZED))
    (map-set missions mission-id
      (merge mission
        {
          status: "completed",
          report-hash: (some report-hash),
          completed-at: (some block-height)
        }
      )
    )
    (print { event: "report-submitted", id: mission-id, hash: report-hash })
    (ok true)
  )
)

(define-public (audit-mission (mission-id uint) (approved bool))
  (let ((mission (unwrap! (map-get? missions mission-id) (err ERR-MISSION-NOT-FOUND))))
    (asserts! (is-eq (get status mission) "completed") (err ERR-STATUS-TRANSITION))
    (asserts! (is-some (get report-hash mission)) (err ERR-REPORT-MISSING))
    (map-set missions mission-id
      (merge mission
        { status: (if approved "audited" "rejected") }
      )
    )
    (if approved
      (try! (as-contract (stx-transfer? (get budget mission) tx-sender (get proposer mission))))
      (ok false)
    )
    (print { event: "mission-audited", id: mission-id, approved: approved })
    (ok true)
  )
)

(define-public (update-quorum (new-quorum uint))
  (begin
    (asserts! (is-eq tx-sender (var-get dao-treasury)) (err ERR-UNAUTHORIZED))
    (asserts! (and (>= new-quorum u10) (<= new-quorum u90)) (err ERR-INVALID-QUORUM))
    (var-set min-quorum-percent new-quorum)
    (ok true)
  )
)

(define-public (transfer-treasury (new-treasury principal))
  (begin
    (asserts! (is-eq tx-sender (var-get dao-treasury)) (err ERR-UNAUTHORIZED))
    (var-set dao-treasury new-treasury)
    (ok true)
  )
)

(define-public (emergency-withdraw (amount uint) (to principal))
  (begin
    (asserts! (is-eq tx-sender (var-get dao-treasury)) (err ERR-UNAUTHORIZED))
    (as-contract (stx-transfer? amount tx-sender to))
  )
)