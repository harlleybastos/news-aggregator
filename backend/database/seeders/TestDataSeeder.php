<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\Source;
use App\Models\Article;
use Illuminate\Database\Seeder;

class TestDataSeeder extends Seeder
{
    public function run(): void
    {
        // Create categories
        $categories = [
            ['name' => 'Technology', 'slug' => 'technology'],
            ['name' => 'Business', 'slug' => 'business'],
            ['name' => 'Science', 'slug' => 'science'],
            ['name' => 'Health', 'slug' => 'health'],
            ['name' => 'Sports', 'slug' => 'sports'],
        ];

        foreach ($categories as $category) {
            Category::create($category);
        }

        // Create sources
        $sources = [
            [
                'name' => 'Test Source 1',
                'slug' => 'test-source-1',
                'api_source' => 'newsapi',
                'api_id' => 'test-1'
            ],
            [
                'name' => 'Test Source 2',
                'slug' => 'test-source-2',
                'api_source' => 'guardian',
                'api_id' => 'test-2'
            ],
            [
                'name' => 'Test Source 3',
                'slug' => 'test-source-3',
                'api_source' => 'nytimes',
                'api_id' => 'test-3'
            ]
        ];

        foreach ($sources as $source) {
            Source::create($source);
        }

        // Create articles
        foreach (Source::all() as $source) {
            for ($i = 1; $i <= 5; $i++) {
                $article = Article::create([
                    'source_id' => $source->id,
                    'title' => "Test Article {$i} from {$source->name}",
                    'description' => 'This is a test description for the article.',
                    'content' => 'This is the main content of the test article. It contains more detailed information.',
                    'author' => 'Test Author',
                    'url' => "https://example.com/article-{$i}",
                    'image_url' => "https://example.com/images/article-{$i}.jpg",
                    'published_at' => now()->subHours($i),
                    'api_source' => $source->api_source,
                    'api_id' => "test-article-{$source->id}-{$i}"
                ]);

                // Attach random categories to each article
                $randomCategories = Category::inRandomOrder()->limit(2)->get();
                $article->categories()->attach($randomCategories->pluck('id'));
            }
        }
    }
}
