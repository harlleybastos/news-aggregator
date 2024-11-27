import type { ArticleFilters } from '../../../types';

interface FiltersProps {
  filters: ArticleFilters;
  onFilterChange: (filters: ArticleFilters) => void;
}

export default function ArticleFilters({ filters, onFilterChange }: FiltersProps) {
  const handleChange = (key: keyof ArticleFilters, value: string | string[]) => {
    onFilterChange({ ...filters, [key]: value });
  };

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div>
        <input
          type="text"
          placeholder="Search articles..."
          value={filters.search}
          onChange={(e) => handleChange('search', e.target.value)}
          className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Date Range */}
        <div>
          <label className="block text-sm font-medium text-gray-700">From Date</label>
          <input
            type="date"
            value={filters.from_date || ''}
            onChange={(e) => handleChange('from_date', e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">To Date</label>
          <input
            type="date"
            value={filters.to_date || ''}
            onChange={(e) => handleChange('to_date', e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          />
        </div>

        {/* Sort */}
        <div>
          <label className="block text-sm font-medium text-gray-700">Sort By</label>
          <select
            value={filters.sort_by || 'published_at'}
            onChange={(e) => handleChange('sort_by', e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          >
            <option value="published_at">Date</option>
            <option value="title">Title</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Sort Order</label>
          <select
            value={filters.sort_order || 'desc'}
            onChange={(e) => handleChange('sort_order', e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
          >
            <option value="desc">Newest First</option>
            <option value="asc">Oldest First</option>
          </select>
        </div>
      </div>
    </div>
  );
}
