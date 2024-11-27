<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::dropIfExists('user_preferences');

        Schema::create('user_preferences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->json('preferred_categories')->nullable();
            $table->json('preferred_sources')->nullable();
            $table->json('preferred_authors')->nullable();
            $table->boolean('email_notifications')->default(false);
            $table->enum('update_frequency', ['daily', 'weekly', 'never'])->default('daily');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_preferences');
    }
};
