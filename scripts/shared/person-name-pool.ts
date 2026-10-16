/**
 * person-name-pool.ts
 * Shared, simulation-agnostic first/last name pools with gender tags.
 * Intended for any generator that needs plausible, diverse contact names.
 */

export interface NamedPerson {
  firstName: string;
  gender: "male" | "female";
}

/** Culturally diverse first names with gender tags (~40 entries). */
export const FIRST_NAME_POOL: NamedPerson[] = [
  { firstName: "Dana", gender: "female" },
  { firstName: "Marcus", gender: "male" },
  { firstName: "Priya", gender: "female" },
  { firstName: "Wei", gender: "male" },
  { firstName: "Fatima", gender: "female" },
  { firstName: "Diego", gender: "male" },
  { firstName: "Amara", gender: "female" },
  { firstName: "Noah", gender: "male" },
  { firstName: "Sofia", gender: "female" },
  { firstName: "Kenji", gender: "male" },
  { firstName: "Aisha", gender: "female" },
  { firstName: "Omar", gender: "male" },
  { firstName: "Elena", gender: "female" },
  { firstName: "Jamal", gender: "male" },
  { firstName: "Mei", gender: "female" },
  { firstName: "Lars", gender: "male" },
  { firstName: "Ingrid", gender: "female" },
  { firstName: "Ravi", gender: "male" },
  { firstName: "Camila", gender: "female" },
  { firstName: "Theo", gender: "male" },
  { firstName: "Nia", gender: "female" },
  { firstName: "Hiro", gender: "male" },
  { firstName: "Leila", gender: "female" },
  { firstName: "Andre", gender: "male" },
  { firstName: "Yara", gender: "female" },
  { firstName: "Soren", gender: "male" },
  { firstName: "Anika", gender: "female" },
  { firstName: "Mateo", gender: "male" },
  { firstName: "Zara", gender: "female" },
  { firstName: "Ibrahim", gender: "male" },
  { firstName: "Hana", gender: "female" },
  { firstName: "Felix", gender: "male" },
  { firstName: "Aiko", gender: "female" },
  { firstName: "Dmitri", gender: "male" },
  { firstName: "Noor", gender: "female" },
  { firstName: "Kwame", gender: "male" },
  { firstName: "Isla", gender: "female" },
  { firstName: "Rafael", gender: "male" },
  { firstName: "Sana", gender: "female" },
  { firstName: "Evan", gender: "male" },
];

/** Culturally diverse last names (~40 entries). */
export const LAST_NAME_POOL: string[] = [
  "Reyes",
  "Chen",
  "Nguyen",
  "Wright",
  "Okafor",
  "Kowalski",
  "Patel",
  "Martinez",
  "Andersson",
  "Kim",
  "Hassan",
  "Nakamura",
  "Silva",
  "Weber",
  "Johansson",
  "Garcia",
  "Singh",
  "Mbeki",
  "Rossi",
  "Ali",
  "Park",
  "Dubois",
  "Okoye",
  "Berg",
  "Fernandez",
  "Cohen",
  "Tanaka",
  "Ibrahim",
  "Novak",
  "Torres",
  "Mwangi",
  "Lopez",
  "Schmidt",
  "Cho",
  "Almeida",
  "Bakker",
  "Rahman",
  "Sullivan",
  "Petrov",
  "Yilmaz",
];

/**
 * Picks a random element from a non-empty array.
 */
function pickRandom<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T;
}

/**
 * Returns a random first-name/gender pair combined with a random last name, drawn
 * with the caller's random source (seeded for reproducible generation).
 */
export function randomPerson(random: () => number): NamedPerson & { lastName: string } {
  const person = pickRandom(FIRST_NAME_POOL, random);
  return {
    firstName: person.firstName,
    gender: person.gender,
    lastName: pickRandom(LAST_NAME_POOL, random),
  };
}
