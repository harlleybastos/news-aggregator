import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { preferencesApi } from '../../services/api';
import type { PreferencesResponse, PreferenceUpdatePayload } from '../../types';

export default function PreferencesPage() {
  const queryClient = useQueryClient();
  const [selectedCategories, setSelectedCategories] = useState<number[]>([]);
  const [selectedSources, setSelectedSources] = useState<number[]>([]);
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [updateFrequency, setUpdateFrequency] = useState<'daily' | 'weekly' | 'never'>(
    'daily'
  );

  const { data, isLoading } = useQuery<PreferencesResponse, Error>({
    queryKey: ['preferences'],
    queryFn: preferencesApi.getPreferences,
  });

  const { mutate: updatePreferences, isPending } = useMutation({
    mutationFn: (preferences: PreferenceUpdatePayload) =>
      preferencesApi.updatePreferences(preferences),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
  });

  const handleCategoryToggle = (categoryId: number) => {
    setSelectedCategories((prev) =>
      prev.includes(categoryId) ? prev.filter((id) => id !== categoryId) : [...prev, categoryId]
    );
  };

  useEffect(() => {
    if (data?.preferences) {
      setSelectedCategories(data.preferences.preferred_categories);
      setSelectedSources(data.preferences.preferred_sources);
      setEmailNotifications(data.preferences.email_notifications);
      setUpdateFrequency(data.preferences.update_frequency);
    }
  }, [data]);

  const handleSourceToggle = (sourceId: number) => {
    setSelectedSources((prev) =>
      prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId]
    );
  };

  const handleSave = () => {
    updatePreferences({
      preferred_categories: selectedCategories,
      preferred_sources: selectedSources,
      email_notifications: emailNotifications,
      update_frequency: updateFrequency,
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">News Preferences</h2>
        <p className="mt-1 text-gray-600">
          Customize your news feed by selecting your preferred categories and sources.
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Categories</h3>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {data?.available_categories.map((category) => (
              <label key={category.id} className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary-600"
                  checked={selectedCategories.includes(category.id)}
                  onChange={() => handleCategoryToggle(category.id)}
                />
                <span className="text-gray-900">{category.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-medium text-gray-900">Sources</h3>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {data?.available_sources.map((source) => (
              <label key={source.id} className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary-600"
                  checked={selectedSources.includes(source.id)}
                  onChange={() => handleSourceToggle(source.id)}
                />
                <span className="text-gray-900">{source.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-medium text-gray-900">Notification Preferences</h3>
          <div className="mt-4 space-y-4">
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-primary-600"
                checked={emailNotifications}
                onChange={(e) => setEmailNotifications(e.target.checked)}
              />
              <span className="text-gray-900">Receive email notifications</span>
            </label>

            <div>
              <label className="block text-sm font-medium text-gray-700">Update Frequency</label>
              <select
                value={updateFrequency}
                onChange={(e) => setUpdateFrequency(e.target.value as 'daily' | 'weekly' | 'never')}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="never">Never</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isPending ? 'Saving...' : 'Save preferences'}
          </button>
        </div>
      </div>
    </div>
  );
}
