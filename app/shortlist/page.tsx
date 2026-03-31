import Link from "next/link";

export default function ShortlistPlaceholderPage() {
  return (
    <div className="p-8">
      <p className="text-gray-600">Shortlist — coming soon.</p>
      <Link href="/" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
        ← Back to Filter &amp; Search
      </Link>
    </div>
  );
}
