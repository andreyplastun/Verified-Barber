import { pool } from "../server/db";

const defaultSpecialists = [
  {
    name: "Vladimir",
    specialty: "Master Barber",
    bio: "Expert in traditional and modern cuts",
    imageUrl: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800&q=80",
  },
  {
    name: "Timur 1",
    specialty: "Barber",
    bio: "Short cuts and fades",
    imageUrl: "https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=800&q=80",
  },
  {
    name: "Zhanibek",
    specialty: "Barber",
    bio: "Precision lineups",
    imageUrl: "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=800&q=80",
  },
  {
    name: "Akerke",
    specialty: "Stylist",
    bio: "Creative hair & style",
    imageUrl: "https://images.unsplash.com/photo-1604654894610-df63bc536371?w=800&q=80",
  },
  {
    name: "Gauhar",
    specialty: "Stylist",
    bio: "Color and styling",
    imageUrl: "https://images.unsplash.com/photo-1519014816548-bf5fe059798b?w=800&q=80",
  },
  {
    name: "Sergey",
    specialty: "Master Barber",
    bio: "Classic & straight razor",
    imageUrl: "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=800&q=80",
  },
  {
    name: "Timur 2",
    specialty: "Barber",
    bio: "Fades and beard shaping",
    imageUrl: "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=800&q=80",
  }
];

async function run() {
  for (const spec of defaultSpecialists) {
    try {
      await pool.query(
        `INSERT INTO specialists (name, specialty, bio, image_url, rating, review_count, average_rating)
         VALUES ($1, $2, $3, $4, '0', 0, 0)`,
        [spec.name, spec.specialty, spec.bio, spec.imageUrl]
      );
      console.log("Inserted:", spec.name);
    } catch (e: any) {
      console.error("Error inserting:", spec.name, e.message);
    }
  }
  console.log("DONE: specialists created");
  await pool.end();
}

run();
