-- 0055 — A TOUCH POINT IS RATED, NOT PRAISED OR REPORTED (v33.33)
--
-- Feedback on a session travelled the same two-way road as feedback about a
-- PERSON: 🎉 shout-out or 😟 concern. Neither fits a meeting. "The working
-- hours were fine but too long" is not a concern about anybody and not a
-- celebration of anyone — it is a review, and the thing every review wants
-- first is a score you can average across sessions.
--
-- So a touch-point review carries 1–5 stars. `positive` stays NOT NULL for
-- every existing reader (it is derived from the stars: 4+ = positive), and
-- feedback about a person is untouched — it has no rating and never will.

alter table lc_feedback
  add column if not exists rating smallint
    check (rating is null or (rating between 1 and 5));

comment on column lc_feedback.rating is
  'Touch-point reviews only (v33.33): 1–5 stars. NULL for feedback about a person.';
