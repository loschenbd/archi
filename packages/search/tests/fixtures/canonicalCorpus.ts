export type FixturePassage = {
  id: string;
  work_id: string;
  body: string;
  creator: string;
  display_title: string;
  is_starred?: boolean;
  marker_color?: string;
  marked_at?: string;
};

export type FixtureWork = {
  id: string;
  display_title: string;
  creator: string;
  work_type: string;
};

export const FIXTURE_WORKS: FixtureWork[] = [
  { id: "w-aurelius", display_title: "Meditations", creator: "Marcus Aurelius", work_type: "book" },
  { id: "w-seneca", display_title: "Letters from a Stoic", creator: "Seneca", work_type: "book" },
  { id: "w-aristotle", display_title: "Nicomachean Ethics", creator: "Aristotle", work_type: "book" }
];

export const FIXTURE_PASSAGES: FixturePassage[] = [
  { id: "p-anger-1", work_id: "w-aurelius", body: "Anger cannot be dishonest.", creator: "Marcus Aurelius", display_title: "Meditations", is_starred: true },
  { id: "p-anger-2", work_id: "w-aurelius", body: "Whenever you are about to find fault with someone, remember that anger is short madness.", creator: "Marcus Aurelius", display_title: "Meditations" },
  { id: "p-anger-3", work_id: "w-seneca", body: "The greatest remedy for anger is delay.", creator: "Seneca", display_title: "Letters from a Stoic" },
  { id: "p-death", work_id: "w-aurelius", body: "Do not despise death, but be well content with it.", creator: "Marcus Aurelius", display_title: "Meditations" },
  { id: "p-time", work_id: "w-seneca", body: "It is not that we have a short time to live, but that we waste a lot of it.", creator: "Seneca", display_title: "Letters from a Stoic" },
  { id: "p-friend", work_id: "w-aristotle", body: "A friend to all is a friend to none.", creator: "Aristotle", display_title: "Nicomachean Ethics" },
  { id: "p-virtue", work_id: "w-aristotle", body: "We are what we repeatedly do. Excellence is a habit.", creator: "Aristotle", display_title: "Nicomachean Ethics" }
];
