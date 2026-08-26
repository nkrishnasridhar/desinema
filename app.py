from flask import Flask, jsonify, render_template

app = Flask(__name__)

LANGUAGES = [
    "hindi",
    "tamil",
    "telugu",
    "malayalam",
    "kannada",
    "bengali",
    "punjabi",
    "marathi",
]


@app.route("/")
def index():
    return render_template("index.html", languages=LANGUAGES)


@app.route("/api/search")
def search():
    return jsonify({"results": [], "error": "Search is not implemented yet."}), 501


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
