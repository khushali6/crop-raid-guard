import boar from "@/assets/boar.jpg";
import deer from "@/assets/deer.jpg";
import fieldImage from "@/assets/fields.jpg";
export { boar, deer, fieldImage };
export const footage = [
  {
    id: "camera-01",
    name: "Camera 01 — North Field",
    field: "North Field",
    date: "Oct 5, 2026",
    duration: "18:42",
    events: 11,
    risk: "High",
    image: boar,
  },
  {
    id: "camera-02",
    name: "Camera 02 — South Field",
    field: "South Field",
    date: "Oct 4, 2026",
    duration: "24:16",
    events: 8,
    risk: "Low",
    image: deer,
  },
  {
    id: "camera-03",
    name: "Camera 03 — East Field",
    field: "East Field",
    date: "Oct 4, 2026",
    duration: "12:08",
    events: 5,
    risk: "Moderate",
    image: fieldImage,
  },
];
export const initialFields = [
  { id: "north", name: "North Field", crop: "Maize", cameras: 2, videos: 18, risk: "High" },
  { id: "south", name: "South Field", crop: "Rice", cameras: 1, videos: 12, risk: "Low" },
  { id: "east", name: "East Field", crop: "Sugarcane", cameras: 2, videos: 8, risk: "Moderate" },
];
export const events = [
  {
    time: "02:14",
    seconds: 134,
    species: "Wild boar",
    confidence: 94,
    field: "North Field",
    risk: "High",
    image: boar,
  },
  {
    time: "08:12",
    seconds: 492,
    species: "Spotted deer",
    confidence: 88,
    field: "North Field",
    risk: "Moderate",
    image: deer,
  },
  {
    time: "14:21",
    seconds: 861,
    species: "Wild boar",
    confidence: 96,
    field: "North Field",
    risk: "High",
    image: boar,
  },
];
export function downloadText(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
