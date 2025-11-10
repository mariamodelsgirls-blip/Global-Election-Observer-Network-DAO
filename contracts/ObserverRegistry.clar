;; ObserverRegistry.clar

(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-ALREADY-REGISTERED u101)
(define-constant ERR-NOT-REGISTERED u102)
(define-constant ERR-INVALID-SCORE u103)
(define-constant ERR-INVALID-BIO u104)
(define-constant ERR-INVALID-LANGUAGE u105)
(define-constant ERR-INVALID-COUNTRY u106)
(define-constant ERR-MISSION-NOT-ACTIVE u107)
(define-constant ERR-ALREADY-APPLIED u108)
(define-constant ERR-SLOTS-FULL u109)
(define-constant ERR-NOT-SELECTED u110)
(define-constant ERR-ALREADY-REVIEWED u111)
(define-constant ERR-INVALID-RATING u112)

(define-data-var registry-active bool true)
(define-data-var min-reputation uint u50)
(define-data-var max-bio-length uint u500)
(define-data-var treasury principal tx-sender)

(define-map observers principal {
  reputation: uint,
  missions-completed: uint,
  bio: (string-utf8 500),
  languages: (list 10 (string-ascii 10)),
  countries: (list 20 (string-ascii 80)),
  joined-at: uint,
  is-active: bool,
  total-earned: uint
})

(define-map mission-applications { mission-id: uint, observer: principal } bool)
(define-map selected-observers { mission-id: uint, observer: principal } bool)
(define-map observer-reviews { mission-id: uint, reviewer: principal } { rating: uint, comment: (string-utf8 280) })

(define-read-only (get-observer (observer principal))
  (map-get? observers observer)
)

(define-read-only (is-registered (observer principal))
  (is-some (map-get? observers observer))
)

(define-read-only (has-applied (mission-id uint) (observer principal))
  (default-to false (map-get? mission-applications { mission-id: mission-id, observer: observer }))
)

(define-read-only (is-selected (mission-id uint) (observer principal))
  (default-to false (map-get? selected-observers { mission-id: mission-id, observer: observer }))
)

(define-read-only (get-review (mission-id uint) (reviewer principal))
  (map-get? observer-reviews { mission-id: mission-id, reviewer: reviewer })
)

(define-public (register-observer
  (bio (string-utf8 500))
  (languages (list 10 (string-ascii 10)))
  (countries (list 20 (string-ascii 80)))
)
  (let ((observer tx-sender))
    (asserts! (var-get registry-active) (err ERR-UNAUTHORIZED))
    (asserts! (is-none (map-get? observers observer)) (err ERR-ALREADY-REGISTERED))
    (asserts! (<= (len bio) (var-get max-bio-length)) (err ERR-INVALID-BIO))
    (map-set observers observer {
      reputation: u100,
      missions-completed: u0,
      bio: bio,
      languages: languages,
      countries: countries,
      joined-at: block-height,
      is-active: true,
      total-earned: u0
    })
    (print { event: "observer-registered", observer: observer })
    (ok true)
  )
)

(define-public (update-profile
  (bio (string-utf8 500))
  (languages (list 10 (string-ascii 10)))
  (countries (list 20 (string-ascii 80)))
)
  (let ((observer tx-sender)
        (current (unwrap! (map-get? observers observer) (err ERR-NOT-REGISTERED))))
    (asserts! (get is-active current) (err ERR-UNAUTHORIZED))
    (asserts! (<= (len bio) (var-get max-bio-length)) (err ERR-INVALID-BIO))
    (map-set observers observer
      (merge current {
        bio: bio,
        languages: languages,
        countries: countries
      })
    )
    (ok true)
  )
)

(define-public (apply-to-mission (mission-id uint))
  (let ((observer tx-sender)
        (mission (contract-call? .mission-manager get-mission mission-id)))
    (asserts! (is-some mission) (err ERR-MISSION-NOT-FOUND))
    (asserts! (is-eq (get status (unwrap! mission (err ERR-MISSION-NOT-FOUND))) "active") (err ERR-MISSION-NOT-ACTIVE))
    (asserts! (is-registered observer) (err ERR-NOT-REGISTERED))
    (asserts! (not (has-applied mission-id observer)) (err ERR-ALREADY-APPLIED))
    (let ((profile (unwrap! (get-observer observer) (err ERR-NOT-REGISTERED))))
      (asserts! (>= (get reputation profile) (var-get min-reputation)) (err ERR-INVALID-SCORE))
    )
    (map-set mission-applications { mission-id: mission-id, observer: observer } true)
    (print { event: "application-submitted", mission-id: mission-id, observer: observer })
    (ok true)
  )
)

(define-public (select-observer (mission-id uint) (observer principal))
  (let ((mission (unwrap! (contract-call? .mission-manager get-mission mission-id) (err ERR-MISSION-NOT-FOUND)))
        (proposer (get proposer mission)))
    (asserts! (is-eq tx-sender proposer) (err ERR-UNAUTHORIZED))
    (asserts! (is-eq (get status mission) "active") (err ERR-MISSION-NOT-ACTIVE))
    (asserts! (has-applied mission-id observer) (err ERR-NOT-SELECTED))
    (asserts! (is-registered observer) (err ERR-NOT-REGISTERED))
    (let ((selected-count (fold check-selected observers u0)))
      (asserts! (< selected-count (get observer-slots mission)) (err ERR-SLOTS-FULL))
    )
    (map-set selected-observers { mission-id: mission-id, observer: observer } true)
    (print { event: "observer-selected", mission-id: mission-id, observer: observer })
    (ok true)
  )
)

(define-private (check-selected (observer principal) (count uint))
  (if (is-selected (get mission-id (get observer observer)) observer) (+ count u1) count)
)

(define-public (submit-review (mission-id uint) (observer principal) (rating uint) (comment (string-utf8 280)))
  (let ((mission (unwrap! (contract-call? .mission-manager get-mission mission-id) (err ERR-MISSION-NOT-FOUND)))
        (proposer (get proposer mission)))
    (asserts! (is-eq tx-sender proposer) (err ERR-UNAUTHORIZED))
    (asserts! (is-eq (get status mission) "completed") (err ERR-INVALID-STATUS))
    (asserts! (is-selected mission-id observer) (err ERR-NOT-SELECTED))
    (asserts! (is-none (get-review mission-id tx-sender)) (err ERR-ALREADY-REVIEWED))
    (asserts! (and (>= rating u1) (<= rating u5)) (err ERR-INVALID-RATING))
    (map-set observer-reviews
      { mission-id: mission-id, reviewer: tx-sender }
      { rating: rating, comment: comment }
    )
    (let ((observer-data (unwrap! (get-observer observer) (err ERR-NOT-REGISTERED))))
      (map-set observers observer
        (merge observer-data {
          reputation: (+ (get reputation observer-data) (if (>= rating u4) u10 u0)),
          missions-completed: (+ (get missions-completed observer-data) u1)
        })
      )
    )
    (print { event: "review-submitted", mission-id: mission-id, observer: observer, rating: rating })
    (ok true)
  )
)

(define-public (deactivate-observer (observer principal))
  (begin
    (asserts! (is-eq tx-sender (var-get treasury)) (err ERR-UNAUTHORIZED))
    (map-set observers observer (merge (unwrap! (get-observer observer) (err ERR-NOT-REGISTERED)) { is-active: false }))
    (ok true)
  )
)

(define-public (toggle-registry (active bool))
  (begin
    (asserts! (is-eq tx-sender (var-get treasury)) (err ERR-UNAUTHORIZED))
    (var-set registry-active active)
    (ok true)
  )
)

(define-public (update-min-reputation (new-min uint))
  (begin
    (asserts! (is-eq tx-sender (var-get treasury)) (err ERR-UNAUTHORIZED))
    (var-set min-reputation new-min)
    (ok true)
  )
)