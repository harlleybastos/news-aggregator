<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserPreference extends Model
{
    protected $fillable = [
        'user_id',
        'preferred_categories',
        'preferred_sources',
        'preferred_authors'
    ];

    protected $casts = [
        'preferred_categories' => 'array',
        'preferred_sources' => 'array',
        'preferred_authors' => 'array'
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
