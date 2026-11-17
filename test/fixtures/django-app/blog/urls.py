from django.urls import path, re_path
from . import views
urlpatterns = [
    path("", views.index, name="index"),
    path("posts/<int:pk>/", views.detail, name="detail"),
    re_path(r"^archive/(?P<year>[0-9]{4})/$", views.archive),
]
