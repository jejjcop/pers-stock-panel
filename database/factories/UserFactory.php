<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

/**
 * Makes users for tests: User::factory()->create() saves one with the
 * password 'password', unless the test gives another.
 *
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    protected static ?string $password;

    public function definition(): array
    {
        return [
            'name' => 'owner',
            'password' => static::$password ??= Hash::make('password'),
        ];
    }
}
