import UIKit

@MainActor
final class KeyboardCardCell: UICollectionViewCell {
    static let reuseIdentifier = "KeyboardCardCell"

    private let headerStack = UIStackView()
    private let kindIcon = UIImageView()
    private let kindLabel = UILabel()
    private let timeLabel = UILabel()
    private let activity = UIActivityIndicatorView(style: .medium)
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let imageView = UIImageView()
    private let actedOverlay = UIView()
    private let actedLabel = UILabel()
    private var thumbnailTask: Task<Void, Never>?
    private var representedID: UUID?
    private var thumbnailRequest: KeyboardThumbnailRequest?

    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.backgroundColor = KeyboardSurface.itemUIColor
        contentView.layer.cornerRadius = 18
        contentView.layer.cornerCurve = .continuous
        contentView.clipsToBounds = true

        headerStack.axis = .horizontal
        headerStack.spacing = 5
        headerStack.alignment = .center
        headerStack.translatesAutoresizingMaskIntoConstraints = false
        kindIcon.contentMode = .scaleAspectFit
        kindIcon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 11, weight: .bold)
        kindIcon.widthAnchor.constraint(equalToConstant: 13).isActive = true
        kindLabel.font = .preferredFont(forTextStyle: .caption1).withWeight(.semibold)
        timeLabel.font = .preferredFont(forTextStyle: .caption2)
        timeLabel.textColor = .tertiaryLabel
        activity.hidesWhenStopped = true
        headerStack.addArrangedSubview(kindIcon)
        headerStack.addArrangedSubview(kindLabel)
        headerStack.addArrangedSubview(timeLabel)
        headerStack.addArrangedSubview(UIView())
        headerStack.addArrangedSubview(activity)

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.font = .preferredFont(forTextStyle: .callout)
        titleLabel.textColor = .label
        titleLabel.numberOfLines = 5
        titleLabel.textAlignment = .left
        subtitleLabel.translatesAutoresizingMaskIntoConstraints = false
        subtitleLabel.font = .preferredFont(forTextStyle: .caption2)
        subtitleLabel.textColor = .systemBlue
        subtitleLabel.lineBreakMode = .byTruncatingMiddle
        imageView.translatesAutoresizingMaskIntoConstraints = false
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.layer.cornerRadius = 10
        imageView.layer.cornerCurve = .continuous
        imageView.tintColor = .secondaryLabel
        imageView.backgroundColor = UIColor.systemOrange.withAlphaComponent(0.12)

        actedOverlay.translatesAutoresizingMaskIntoConstraints = false
        actedOverlay.backgroundColor = KeyboardSurface.itemUIColor.withAlphaComponent(0.94)
        actedOverlay.isHidden = true
        actedLabel.translatesAutoresizingMaskIntoConstraints = false
        actedLabel.font = .preferredFont(forTextStyle: .subheadline).withWeight(.semibold)
        actedLabel.textColor = .systemGreen
        actedLabel.textAlignment = .center
        actedOverlay.addSubview(actedLabel)

        [headerStack, titleLabel, subtitleLabel, imageView, actedOverlay].forEach(contentView.addSubview)
        NSLayoutConstraint.activate([
            headerStack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12),
            headerStack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12),
            headerStack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
            titleLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12),
            titleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12),
            titleLabel.topAnchor.constraint(equalTo: headerStack.bottomAnchor, constant: 8),
            titleLabel.bottomAnchor.constraint(lessThanOrEqualTo: contentView.bottomAnchor, constant: -12),
            subtitleLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12),
            subtitleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12),
            subtitleLabel.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12),
            imageView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12),
            imageView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12),
            imageView.topAnchor.constraint(equalTo: headerStack.bottomAnchor, constant: 8),
            imageView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12),
            actedOverlay.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            actedOverlay.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            actedOverlay.topAnchor.constraint(equalTo: contentView.topAnchor),
            actedOverlay.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            actedLabel.centerXAnchor.constraint(equalTo: actedOverlay.centerXAnchor),
            actedLabel.centerYAnchor.constraint(equalTo: actedOverlay.centerYAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func prepareForReuse() {
        super.prepareForReuse()
        thumbnailTask?.cancel()
        thumbnailTask = nil
        representedID = nil
        thumbnailRequest = nil
        imageView.image = nil
        activity.stopAnimating()
        actedOverlay.isHidden = true
    }

    func configure(
        card: KeyboardViewCard,
        loadThumbnail: @escaping (UUID, CGFloat) async -> KeyboardViewThumbnail?
    ) {
        let nextThumbnailRequest = KeyboardThumbnailRequest(cardID: card.id, version: card.thumbnailVersion)
        let retainsThumbnail = !nextThumbnailRequest.requiresReload(from: thumbnailRequest)
        representedID = card.id
        thumbnailRequest = card.kind == .image ? nextThumbnailRequest : nil
        timeLabel.text = card.time
        titleLabel.text = card.title
        subtitleLabel.text = card.subtitle.map { "⌁ \($0)" }
        activity.setAnimating(card.isActing)
        actedOverlay.isHidden = !card.didAct
        actedLabel.text = "✓ " + card.actionConfirmation

        let symbol: String
        let tint: UIColor
        switch card.kind {
        case .text:
            symbol = "text.alignleft"
            tint = .secondaryLabel
        case .link:
            symbol = "link"
            tint = .systemBlue
        case .image:
            symbol = "photo"
            tint = .systemOrange
        }
        kindIcon.image = UIImage(systemName: symbol)
        kindIcon.tintColor = tint
        kindLabel.text = card.kindTitle
        kindLabel.textColor = tint
        subtitleLabel.isHidden = card.kind != .link
        imageView.isHidden = card.kind != .image
        titleLabel.isHidden = card.kind == .image

        guard card.kind == .image else {
            thumbnailTask?.cancel()
            thumbnailTask = nil
            return
        }
        guard !retainsThumbnail else { return }
        thumbnailTask?.cancel()
        thumbnailTask = nil
        imageView.image = UIImage(systemName: "photo.badge.arrow.down")
        thumbnailTask = Task { @MainActor [weak self] in
            let image = await loadThumbnail(card.id, 220)
            guard !Task.isCancelled, self?.representedID == card.id else { return }
            self?.imageView.image = image ?? UIImage(systemName: "photo")
        }
    }
}

extension UIActivityIndicatorView {
    func setAnimating(_ animating: Bool) {
        animating ? startAnimating() : stopAnimating()
    }
}
