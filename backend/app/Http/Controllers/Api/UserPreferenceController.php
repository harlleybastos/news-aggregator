<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\UserPreference\UpdatePreferenceRequest;
use App\Models\Category;
use App\Models\Source;
use App\Models\UserPreference;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class UserPreferenceController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $preferences = $request->user()->preferences;

        // If no preferences exist, create default ones
        if (!$preferences) {
            $preferences = UserPreference::create([
                'user_id' => $request->user()->id,
                'preferred_categories' => [],
                'preferred_sources' => [],
                'preferred_authors' => [],
                'email_notifications' => false,
                'update_frequency' => 'daily'
            ]);
        }

        // Load available options for the frontend
        $data = [
            'preferences' => $preferences,
            'available_categories' => Category::select('id', 'name')->get(),
            'available_sources' => Source::select('id', 'name')->get(),
        ];

        return response()->json($data);
    }

    public function update(UpdatePreferenceRequest $request): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validated();

        $preferences = $user->preferences;
        if (!$preferences) {
            $preferences = new UserPreference(['user_id' => $user->id]);
        }

        $preferences->fill($validated);
        $preferences->save();

        return response()->json([
            'message' => 'Preferences updated successfully',
            'preferences' => $preferences
        ]);
    }
}
