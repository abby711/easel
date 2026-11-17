<?php
use Illuminate\Support\Facades\Route;
Route::get('/', function () { return view('welcome'); });
Route::get('/dashboard', [DashboardController::class, 'index']);
Route::view('/terms', 'terms');
Route::get('/users/{user}', [UserController::class, 'show']);
Route::resource('photos', PhotoController::class);
