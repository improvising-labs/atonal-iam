import { BadRequest, ensureValues, NotFound, useInstance } from 'atonal'
import { ObjectId, usePopulateItem } from 'atonal-db'
import { chain } from 'lodash'
import { IAMConfigs } from '../common/configs'
import { Relation, RelationMeta, RelationModel, UserModel } from '../models'

export class RelationProvider {
  constructor(private configs: IAMConfigs) {}

  async createRelation(
    fromUserId: ObjectId,
    toUserId: ObjectId,
    { meta }: { meta?: RelationMeta } = {},
  ) {
    const relation = await RelationModel.findOneAndUpdate(
      {
        from: fromUserId,
        to: toUserId,
      },
      { $set: { meta } },
      { upsert: true },
    )

    return relation!
  }

  async makeConnection(userIds: ObjectId[]) {
    if (userIds.length !== 2) {
      throw new BadRequest('can only pass 2 users')
    }

    const relations = await Promise.all([
      RelationModel.findOneAndUpdate(
        {
          from: userIds[0],
          to: userIds[1],
        },
        {
          $set: {
            connected: true,
          },
          $inc: {
            score: 100,
          },
        },
        { upsert: true },
      ),
      RelationModel.findOneAndUpdate(
        {
          from: userIds[1],
          to: userIds[0],
        },
        {
          $set: {
            connected: true,
          },
          $inc: {
            score: 100,
          },
        },
        { upsert: true },
      ),
    ])

    await this.configs.hooks?.onRelationsConnected?.(relations as Relation[])

    return { success: true }
  }

  async removeConnection(userIds: ObjectId[]) {
    if (userIds.length !== 2) {
      throw new BadRequest('can only pass 2 users')
    }

    const relations = await Promise.all([
      RelationModel.findOneAndUpdate(
        {
          from: userIds[0],
          to: userIds[1],
        },
        {
          $unset: {
            connected: true,
          },
          $inc: {
            score: -100,
          },
        },
        { upsert: true },
      ),
      RelationModel.findOneAndUpdate(
        {
          from: userIds[1],
          to: userIds[0],
        },
        {
          $unset: {
            connected: true,
          },
          $inc: {
            score: -100,
          },
        },
        { upsert: true },
      ),
    ])

    await this.configs.hooks?.onRelationsDisconnected?.(relations as Relation[])

    return { success: true }
  }

  async hasConnection(userIds: ObjectId[]) {
    if (userIds.length !== 2) {
      throw new BadRequest('can only pass 2 users')
    }

    return RelationModel.exists({
      $or: [
        {
          from: userIds[0],
          to: userIds[1],
        },
        {
          from: userIds[1],
          to: userIds[0],
        },
      ],
      connected: true,
    })
  }

  async countRelations({
    opUserId,
    connected,
  }: {
    opUserId?: ObjectId
    connected?: boolean
  }) {
    const count = await RelationModel.countDocuments(
      ensureValues({
        from: opUserId,
        connected,
      }),
    )

    return { count }
  }

  async getRelations(
    {
      fromUserId,
      toUserId,
      connected,
      customFilters,
      sortBy = 'createdAt',
      orderBy = 'asc',
      skip = 0,
      limit = 20,
    }: {
      fromUserId?: ObjectId
      toUserId?: ObjectId
      connected?: boolean
      customFilters?: Record<string, unknown>
      sortBy?: '_id' | 'createdAt' | 'updatedAt'
      orderBy?: 'asc' | 'desc'
      skip?: number
      limit?: number
    },
    { populate = false }: { populate?: boolean } = {},
  ) {
    const relations = await RelationModel.find(
      ensureValues({
        from: fromUserId,
        to: toUserId,
        connected,
        ...customFilters,
      }),
    )
      .sort({ [sortBy]: orderBy === 'asc' ? 1 : -1 })
      .skip(skip)
      .limit(limit)
      .toArray()

    if (populate) {
      await this.populateRelations(relations)
    }

    return relations
  }

  async getRelation(relationId: ObjectId) {
    const relation = await RelationModel.findById(relationId)

    if (!relation) {
      throw new NotFound('relation is not found')
    }

    return relation
  }

  async updateMeta(relationId: ObjectId, partial: Partial<RelationMeta>) {
    const $set = ensureValues(
      chain(partial)
        .mapKeys((_, key) => `meta.${key}`)
        .value(),
    )

    const relation = await RelationModel.findByIdAndUpdate(
      relationId,
      { $set },
      { returnDocument: 'after' },
    )

    if (!relation) {
      throw new NotFound('relation is not found')
    }

    await this.configs.hooks?.onRelationMetaUpdated?.(relation)

    return relation.meta ?? {}
  }

  async populateRelations(relations: Relation[]) {
    return RelationModel.populate(relations, [
      usePopulateItem({
        model: UserModel,
        path: 'from',
        select: ['profile', 'meta'],
      }),
      usePopulateItem({
        model: UserModel,
        path: 'to',
        select: ['profile', 'meta'],
      }),
    ])
  }
}

export const useRelationProvider = () =>
  useInstance<RelationProvider>('IAM.provider.relation')
