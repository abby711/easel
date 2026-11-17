Rails.application.routes.draw do
  root "home#index"
  get "about", to: "pages#about"
  resources :articles do
    resources :comments, only: [:index]
  end
  namespace :admin do
    resources :users, only: [:index, :show]
  end
  resource :profile, only: [:show, :edit]
end
