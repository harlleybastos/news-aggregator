<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\ArticleResource;
use App\Models\Article;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Log;

class ArticleController extends Controller
{
    public function index(Request $request)
    {
        // Check if we have any articles
        if (Article::count() === 0) {
            // No articles found, run the fetch command
            try {
                Log::info('No articles found. Fetching articles for the first time...');
                Artisan::call('news:fetch');
                Log::info('Initial fetch completed successfully.');
            } catch (\Exception $e) {
                Log::error('Initial fetch failed: ' . $e->getMessage());
                return response()->json([
                    'message' => 'Error fetching initial articles',
                    'error' => $e->getMessage()
                ], 500);
            }
        }

        $query = Article::query()->with(['source', 'categories']);

        // Your existing filter logic...
        if ($search = $request->input('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                    ->orWhere('description', 'like', "%{$search}%")
                    ->orWhere('content', 'like', "%{$search}%");
            });
        }

        // Date filters
        if ($fromDate = $request->input('from_date')) {
            $query->where('published_at', '>=', $fromDate);
        }
        if ($toDate = $request->input('to_date')) {
            $query->where('published_at', '<=', $toDate);
        }

        // Source filters
        if ($sources = $request->input('sources')) {
            $query->whereIn('source_id', explode(',', $sources));
        }

        // Sort
        $sortBy = $request->input('sort_by', 'published_at');
        $sortOrder = $request->input('sort_order', 'desc');
        $query->orderBy($sortBy, $sortOrder);

        return ArticleResource::collection(
            $query->paginate($request->input('per_page', 15))
        );
    }

    /**
     * Display the specified resource.
     *
     * @param  int  $id
     * @return \Illuminate\Http\JsonResponse
     */
    public function show($id)
    {
        // Eager load the 'source' relationship
        $article = Article::with('source')->find($id);

        // If article not found, return a 404 response
        if (!$article) {
            return response()->json([
                'message' => 'Article not found',
            ], 404);
        }

        // Return the article data with the source
        return response()->json([
            'id' => $article->id,
            'title' => $article->title,
            'content' => $article->content,
            'description' => $article->description,
            'author' => $article->author,
            'url' => $article->url,
            'image_url' => $article->image_url,
            'published_at' => $article->published_at,
            'api_source' => $article->api_source,
            'source' => $article->source, // Include the source data
        ]);
    }


    public function userFeed(Request $request)
    {
        $user = $request->user();
        $preferences = $user->preferences;

        $query = Article::query()->with(['source', 'categories']);

        if ($preferences) {
            // Apply category preferences
            if (!empty($preferences->preferred_categories)) {
                $query->whereHas('categories', function ($q) use ($preferences) {
                    $q->whereIn('categories.id', $preferences->preferred_categories);
                });
            }

            // Apply source preferences
            if (!empty($preferences->preferred_sources)) {
                $query->whereIn('source_id', $preferences->preferred_sources);
            }

            // Apply author preferences
            if (!empty($preferences->preferred_authors)) {
                $query->whereIn('author', $preferences->preferred_authors);
            }
        }

        // Apply any additional filters from the request
        if ($search = $request->input('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', "%{$search}%")
                    ->orWhere('description', 'like', "%{$search}%");
            });
        }

        $query->orderBy('published_at', 'desc');

        return ArticleResource::collection(
            $query->paginate($request->input('per_page', 15))
        );
    }
}
